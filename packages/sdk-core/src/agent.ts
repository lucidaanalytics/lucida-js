import type { Props } from "./ports.js";

/**
 * Agent analytics (P-AGENT): conversation events for in-product AI agents and chatbots.
 * Product side only: no tokens, latency, cost or model names (Watchtower owns LLM observability); the only
 * Watchtower touchpoint is the optional `$ai_trace_id`. Mirrors sdks/python/src/lucida/_agent.py; both are pinned
 * by testdata/agent-analytics/vectors.json.
 */
export type AgentRole = "user" | "assistant";
export type AgentOutcome = "resolved" | "unresolved" | "escalated" | "abandoned" | "error";
export type AgentFeedbackKind = "thumbs" | "rating" | "comment";

export const AGENT_EVENTS = {
  started: "$ai_conversation_started",
  message: "$ai_message",
  feedback: "$ai_feedback",
  ended: "$ai_conversation_ended",
  outcome: "$ai_outcome",
} as const;

const OUTCOMES: readonly string[] = ["resolved", "unresolved", "escalated", "abandoned", "error"];
const MAX_TEXT = 4000;
const MAX_COMMENT = 2000;

export const AGENT_NEG_PHRASES: readonly string[] = [
  "wrong", "useless", "not helpful", "unhelpful", "doesn't work", "does not work", "didn't help",
  "did not help", "not what i asked", "that's not it", "stupid", "terrible", "awful", "frustrating",
  "frustrated", "annoying", "worst", "hate", "incorrect", "nonsense", "confusing", "makes no sense",
  "real person", "human agent", "talk to a human", "speak to a human", "wtf", "ugh",
];
export const AGENT_POS_PHRASES: readonly string[] = [
  "thanks", "thank you", "great", "perfect", "awesome", "helpful", "that worked", "works now", "solved", "exactly",
];

const cps = (s: string): string[] => Array.from(s);
const cap = (s: string, n: number): string => cps(s).slice(0, n).join("");

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64 = 0xffffffffffffffffn;
const utf8 = new TextEncoder();

function fnv1a64(token: string): bigint {
  let h = FNV_OFFSET;
  for (const b of utf8.encode(token)) h = ((h ^ BigInt(b)) * FNV_PRIME) & U64;
  return h;
}

/** `$ai_text_hash`: simhash64 of the lowercased letter/digit tokens (>= 2 code points); undefined without tokens. */
export function agentTextHash(text: string): string | undefined {
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => cps(t).length >= 2);
  if (!tokens.length) return undefined;
  const v = new Array<number>(64).fill(0);
  for (const t of tokens) {
    const h = fnv1a64(t);
    for (let i = 0; i < 64; i++) v[i] = (v[i] ?? 0) + (((h >> BigInt(i)) & 1n) === 1n ? 1 : -1);
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if ((v[i] ?? 0) > 0) out |= 1n << BigInt(i);
  return out.toString(16).padStart(16, "0");
}

/** `$ai_sentiment`: -1 / 0 / 1 from the shared phrase lexicon; negatives are matched (and removed) first. */
export function agentSentiment(text: string): -1 | 0 | 1 {
  const norm = text.toLowerCase().replace(/’/g, "'").replace(/[.,!?;:]/g, " ");
  let padded = ` ${norm.replace(/\s+/g, " ").trim()} `;
  let neg = 0;
  for (const p of AGENT_NEG_PHRASES) {
    if (padded.includes(` ${p} `)) {
      neg++;
      padded = padded.split(` ${p} `).join(" ");
    }
  }
  const pos = AGENT_POS_PHRASES.filter((p) => padded.includes(` ${p} `)).length;
  return neg > pos ? -1 : pos > neg ? 1 : 0;
}

const asciiDigits = (s: string): number[] => cps(s).filter((c) => c >= "0" && c <= "9").map(Number);

function luhn(s: string): boolean {
  const d = asciiDigits(s);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  d.reverse().forEach((x, i) => (sum += i % 2 === 1 ? (x > 4 ? x * 2 - 9 : x * 2) : x));
  return sum % 10 === 0;
}

// Rust `regex` is Unicode by default: `\d` is \p{Nd} and `\b` uses this word class (crates/lc-replay/src/mask.rs).
const W = String.raw`[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]`;
const RULES: ReadonlyArray<[RegExp, (m: string) => boolean]> = [
  [new RegExp(String.raw`(?<!${W})\p{Nd}(?:[ -]?\p{Nd}){12,18}(?!${W})`, "gu"), luhn],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, () => true],
  [/\+?\p{Nd}[\p{Nd}\s().-]{7,}\p{Nd}/gu, phone],
];

function phone(s: string): boolean {
  const n = asciiDigits(s).length;
  return n >= 10 && n <= 15;
}

const stars = (s: string): string => cps(s).map((c) => (/\s/u.test(c) ? c : "*")).join("");

/** Masked copy (cards, emails, phones -> `*`, whitespace kept), same rules as lc_replay::Masker; undefined when nothing matched. */
export function agentRedact(text: string): string | undefined {
  let cur = text;
  for (const [re, ok] of RULES) cur = cur.replace(re, (m) => (ok(m) ? stars(m) : m));
  return cur === text ? undefined : cur;
}

/** A W3C trace id (32 lowercase hex, lowercased first) or undefined. */
export function agentTraceId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.toLowerCase();
  return /^[0-9a-f]{32}$/.test(t) ? t : undefined;
}

export const agentOutcome = (v: unknown): AgentOutcome | undefined =>
  typeof v === "string" && OUTCOMES.includes(v) ? (v as AgentOutcome) : undefined;

const label = (v: unknown, n: number): string | undefined => (typeof v === "string" && v ? cap(v, n) : undefined);

function textProps(key: string, text: string, n: number): Props {
  const capped = cap(text, n);
  const masked = agentRedact(capped);
  return masked === undefined ? { [key]: capped } : { [key]: masked, $ai_text_redacted: true };
}

/** `$ai_message` props; undefined for a role other than user/assistant. */
export function agentMessageProps(role: string, text: string, index: number, captureText: boolean): Props | undefined {
  if (role !== "user" && role !== "assistant") return undefined;
  const p: Props = { $ai_role: role, $ai_message_index: index, $ai_text_length: cps(text).length };
  if (role === "user") {
    const h = agentTextHash(text);
    if (h !== undefined) p.$ai_text_hash = h;
    p.$ai_sentiment = agentSentiment(text);
  }
  return captureText ? { ...p, ...textProps("$ai_text", text, MAX_TEXT) } : p;
}

export interface AgentFeedback {
  kind: AgentFeedbackKind;
  /** thumbs: 1 up / -1 down; rating: integer 1..5; comment: omitted. */
  value?: number;
  /** Sent only with `captureText`, redacted and capped at 2000 code points. */
  comment?: string;
  messageIndex?: number;
}

/** `$ai_feedback` props; undefined when kind or value is invalid. */
export function agentFeedbackProps(f: AgentFeedback, captureText: boolean): Props | undefined {
  const v = f.value;
  if (f.kind === "thumbs" && v !== 1 && v !== -1) return undefined;
  if (f.kind === "rating" && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5)) return undefined;
  if (f.kind !== "thumbs" && f.kind !== "rating" && f.kind !== "comment") return undefined;
  const p: Props = { $ai_feedback_kind: f.kind };
  if (f.kind !== "comment") p.$ai_feedback_value = v;
  if (f.comment && captureText) {
    const capped = cap(f.comment, MAX_COMMENT);
    p.$ai_feedback_comment = agentRedact(capped) ?? capped;
  }
  if (f.messageIndex !== undefined) p.$ai_message_index = f.messageIndex;
  return p;
}

export function agentOutcomeProps(outcome?: string, resolution?: string): Props {
  const o = agentOutcome(outcome);
  const r = label(resolution, 64);
  return { ...(o ? { $ai_outcome: o } : {}), ...(r ? { $ai_resolution: r } : {}) };
}

export interface AgentConversationOptions {
  /** Default: a new uuid v4. */
  conversationId?: string;
  agentName?: string;
  agentVersion?: string;
  /** W3C trace id for the Watchtower deep link; dropped unless 32 hex. */
  traceId?: string;
  /** Your own labels; they win over Lucida's LLM topic labels. */
  topic?: string;
  useCase?: string;
}

function uuidv4(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Props shared by every event of one conversation. */
export function agentCommonProps(o: AgentConversationOptions = {}): Props {
  const p: Props = { $ai_conversation_id: o.conversationId || uuidv4() };
  const add = (k: string, v: string | undefined): void => void (v !== undefined && (p[k] = v));
  add("$ai_agent_name", label(o.agentName, 128));
  add("$ai_agent_version", label(o.agentVersion, 64));
  add("$ai_topic", label(o.topic, 128));
  add("$ai_use_case", label(o.useCase, 128));
  add("$ai_trace_id", agentTraceId(o.traceId));
  return p;
}

/** One conversation. Every event goes through the client's normal capture path (consent, opt-out, beforeSend). */
export class AgentConversation {
  private next = 0;
  private readonly common: Props;
  private readonly emit: (event: string, props: Props) => void;
  private readonly captureText: boolean;

  constructor(emit: (event: string, props: Props) => void, opts: AgentConversationOptions = {}, captureText = false) {
    this.emit = emit;
    this.captureText = captureText;
    this.common = agentCommonProps(opts);
  }

  get id(): string {
    return this.common.$ai_conversation_id as string;
  }

  private send(event: string, props: Props): void {
    this.emit(event, { ...this.common, ...props });
  }

  /** `$ai_conversation_started`. */
  start(): this {
    this.send(AGENT_EVENTS.started, {});
    return this;
  }

  /** `$ai_message`; `index` auto-increments per conversation unless given. False (no event) for any other role. */
  message(role: AgentRole, text: string, opts: { index?: number } = {}): boolean {
    const i = opts.index ?? this.next;
    const p = agentMessageProps(role, text, i, this.captureText);
    if (!p) return false;
    this.next = i + 1;
    this.send(AGENT_EVENTS.message, p);
    return true;
  }

  /** `$ai_feedback`; false (no event) for an invalid kind/value. */
  feedback(f: AgentFeedback): boolean {
    const p = agentFeedbackProps(f, this.captureText);
    if (!p) return false;
    this.send(AGENT_EVENTS.feedback, p);
    return true;
  }

  /** `$ai_conversation_ended` with an optional outcome (unknown values dropped) and short resolution label. */
  end(outcome?: AgentOutcome, resolution?: string): void {
    this.send(AGENT_EVENTS.ended, agentOutcomeProps(outcome, resolution));
  }

  /** `$ai_outcome`: a resolution known later (e.g. the ticket closed). False (no event) for an unknown outcome. */
  outcome(outcome: AgentOutcome, resolution?: string): boolean {
    const p = agentOutcomeProps(outcome, resolution);
    if (!p.$ai_outcome) return false;
    this.send(AGENT_EVENTS.outcome, p);
    return true;
  }
}

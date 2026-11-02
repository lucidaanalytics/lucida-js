import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_NEG_PHRASES, AGENT_POS_PHRASES, AgentConversation, agentFeedbackProps, agentMessageProps, agentOutcome, agentRedact,
  agentSentiment, agentTextHash, agentTraceId,
} from "../src/index.js";
import type { AgentFeedbackKind, Props } from "../src/index.js";

const dir = process.env.LUCIDA_TESTDATA ? `file://${process.env.LUCIDA_TESTDATA}/agent-analytics/` : new URL("../../../testdata/agent-analytics/", import.meta.url).href;
const load = <T>(f: string): T => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as T;

interface Vectors {
  simhash: Array<{ input: string; hash: string | null }>;
  hamming: Array<{ a: string; b: string; distance: number }>;
  sentiment: Array<{ input: string; sentiment: number }>;
  redaction: Array<{ input: string; output: string | null }>;
  trace_id: Array<{ input: unknown; output: string | null }>;
  outcome: Array<{ input: unknown; output: string | null }>;
  feedback: Array<{ kind: AgentFeedbackKind; value: number | null; valid: boolean }>;
  message: Array<{ name: string; role: string; text: string; capture_text: boolean; props: Props | null }>;
}

const v = load<Vectors>("vectors.json");
const bits = (x: string, y: string): number => [...(BigInt(`0x${x}`) ^ BigInt(`0x${y}`)).toString(2)].filter((c) => c === "1").length;

describe("agent analytics shared vectors", () => {
  it("lexicon file matches the built-in phrases", () => {
    const lex = load<{ neg: string[]; pos: string[] }>("lexicon.json");
    expect(AGENT_NEG_PHRASES).toEqual(lex.neg);
    expect(AGENT_POS_PHRASES).toEqual(lex.pos);
  });
  it("simhash", () => {
    for (const s of v.simhash) expect(agentTextHash(s.input) ?? null, s.input).toBe(s.hash);
    for (const h of v.hamming) expect(bits(agentTextHash(h.a)!, agentTextHash(h.b)!), `${h.a} / ${h.b}`).toBe(h.distance);
  });
  it("sentiment", () => {
    for (const s of v.sentiment) expect(agentSentiment(s.input), s.input).toBe(s.sentiment);
  });
  it("redaction", () => {
    for (const s of v.redaction) expect(agentRedact(s.input) ?? null, s.input).toBe(s.output);
  });
  it("trace id and outcome validation", () => {
    for (const s of v.trace_id) expect(agentTraceId(s.input) ?? null, String(s.input)).toBe(s.output);
    for (const s of v.outcome) expect(agentOutcome(s.input) ?? null, String(s.input)).toBe(s.output);
  });
  it("feedback validation", () => {
    for (const f of v.feedback) {
      const got = agentFeedbackProps({ kind: f.kind, ...(f.value === null ? {} : { value: f.value }) }, false);
      expect(got !== undefined, `${f.kind} ${f.value}`).toBe(f.valid);
    }
  });
  it("message props", () => {
    for (const m of v.message) expect(agentMessageProps(m.role, m.text, 0, m.capture_text) ?? null, m.name).toEqual(m.props);
  });
});

describe("AgentConversation", () => {
  const run = (captureText: boolean) => {
    const sent: Array<[string, Props]> = [];
    const c = new AgentConversation((e, p) => sent.push([e, p]), { agentName: "support-bot", traceId: "4BF92F3577B34DA6A3CE929D0E0E4736", topic: "billing" }, captureText);
    return { c: c.start(), sent };
  };

  it("emits the contract events with common props and auto message index", () => {
    const { c, sent } = run(false);
    expect(c.message("user", "my card 4242 4242 4242 4242 is wrong")).toBe(true);
    expect(c.message("assistant", "Sorry about that")).toBe(true);
    expect(c.message("system" as never, "x")).toBe(false);
    expect(c.message("user", "again", { index: 7 })).toBe(true);
    expect(c.message("user", "next")).toBe(true);
    expect(c.feedback({ kind: "thumbs", value: -1, comment: "bad", messageIndex: 1 })).toBe(true);
    expect(c.feedback({ kind: "rating", value: 9 })).toBe(false);
    c.end("escalated", "handed to support");
    expect(c.outcome("bogus" as never)).toBe(false);
    expect(c.outcome("resolved", "ticket closed")).toBe(true);
    expect(sent.map(([e]) => e)).toEqual([
      "$ai_conversation_started", "$ai_message", "$ai_message", "$ai_message", "$ai_message", "$ai_feedback", "$ai_conversation_ended", "$ai_outcome",
    ]);
    for (const [, p] of sent) {
      expect(p.$ai_conversation_id).toBe(c.id);
      expect(p).toMatchObject({ $ai_agent_name: "support-bot", $ai_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", $ai_topic: "billing" });
      expect(p.$ai_text).toBeUndefined();
      expect(p.$ai_feedback_comment).toBeUndefined();
    }
    expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sent.filter(([e]) => e === "$ai_message").map(([, p]) => p.$ai_message_index)).toEqual([0, 1, 7, 8]);
    expect(sent[1]![1]).toMatchObject({ $ai_role: "user", $ai_sentiment: -1, $ai_text_length: 36 });
    expect(sent[2]![1].$ai_text_hash).toBeUndefined();
    expect(sent[6]![1]).toMatchObject({ $ai_outcome: "escalated", $ai_resolution: "handed to support" });
  });

  it("captureText sends redacted text and comments", () => {
    const { c, sent } = run(true);
    c.message("user", "mail me at jo.e@ex.com");
    c.feedback({ kind: "comment", comment: "call +1 (415) 555-2671" });
    expect(sent[1]![1]).toMatchObject({ $ai_text: "mail me at ***********", $ai_text_redacted: true });
    expect(sent[2]![1]).toMatchObject({ $ai_feedback_kind: "comment", $ai_feedback_comment: "call ** ***** ********" });
    expect(sent[2]![1].$ai_feedback_value).toBeUndefined();
  });

  it("drops an invalid trace id and keeps a given conversation id", () => {
    const sent: Props[] = [];
    new AgentConversation((_e, p) => sent.push(p), { conversationId: "c-1", traceId: "nope" }).start();
    expect(sent[0]).toEqual({ $ai_conversation_id: "c-1" });
  });
});

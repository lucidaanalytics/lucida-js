/** Redaction and safe serialization shared by console and network capture. Everything here runs in the page. */

export const REDACTED = "[redacted]";
const HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token)$/i;
const FIELD_RE = /pass(word|wd|phrase)?|secret|token|api[-_]?key|card|cvv|cvc|ssn|authorization/i;

export const MAX_TEXT = 4096;

export const truncate = (s: string, max = MAX_TEXT): string => (s.length > max ? `${s.slice(0, max)}...[truncated ${s.length - max}]` : s);

export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(h)) out[k] = HEADER_RE.test(k) ? REDACTED : truncate(h[k] ?? "", 512);
  return out;
}

function scrub(v: unknown, depth: number): unknown {
  if (depth > 6 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) o[k] = FIELD_RE.test(k) ? REDACTED : scrub(x, depth + 1);
  return o;
}

/** A JSON or form-encoded body with password-like fields removed, truncated. Unparseable text is kept as text; non-text is "[binary]". */
export function redactBody(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body !== "string") {
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return redactBody(body.toString());
    return "[binary]";
  }
  const t = body.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return truncate(JSON.stringify(scrub(JSON.parse(t), 0)));
    } catch {
      /* not JSON: fall through to text */
    }
  }
  if (/^[^\s=&]+=[^\s]*$/.test(t)) {
    const p = new URLSearchParams(t);
    for (const k of [...p.keys()]) if (FIELD_RE.test(k)) p.set(k, REDACTED);
    return truncate(p.toString());
  }
  return truncate(body);
}

/** String form of any console argument: cycles, DOM nodes, errors, functions and throwing getters never throw. */
export function safeString(v: unknown, max = 1000): string {
  try {
    if (typeof v === "string") return truncate(v, max);
    if (v instanceof Error) return truncate(`${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`, max);
    if (typeof Node !== "undefined" && v instanceof Node) return `<${v.nodeName.toLowerCase()}>`;
    if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
    if (v === null || typeof v !== "object") return String(v);
    const seen = new WeakSet<object>();
    return truncate(
      JSON.stringify(v, (k, x: unknown) => {
        if (typeof x === "bigint") return String(x);
        if (typeof Node !== "undefined" && x instanceof Node) return `<${x.nodeName.toLowerCase()}>`;
        if (x !== null && typeof x === "object") {
          if (seen.has(x)) return "[Circular]";
          seen.add(x);
        }
        return FIELD_RE.test(k) ? REDACTED : x;
      }),
      max,
    );
  } catch {
    return "[unserializable]";
  }
}

export type Pattern = string | RegExp;
/** String = substring match, RegExp = test (lastIndex reset so /g patterns stay stable). */
export const matches = (list: Pattern[] | undefined, url: string): boolean =>
  !!list?.some((p) => {
    if (typeof p === "string") return url.includes(p);
    p.lastIndex = 0;
    return p.test(url);
  });

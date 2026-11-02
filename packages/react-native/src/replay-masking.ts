/**
 * P-M17 masked screens and P-M46 text patterns. The native encoders apply both (they receive `maskScreen` and
 * `maskTextPatterns` with every capture, screenshots included); [maskSnapshotText] re-applies the patterns to the
 * returned wireframe in JS as well. Remote lists add to the local ones, so they can only tighten.
 */

const escape = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive match of the whole screen name; `*` matches any run of characters. Empty list = false. */
export function screenMasked(screen: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => new RegExp(`^${p.split("*").map(escape).join(".*")}$`, "is").test(screen));
}

/** Patterns that fail to compile are dropped, never fatal. No built-in patterns: the server masks emails/cards/phones again. */
export function compilePatterns(patterns: readonly string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of new Set(patterns)) {
    if (!p) continue;
    try {
      out.push(new RegExp(p, "g"));
    } catch {
      /* invalid pattern: ignored */
    }
  }
  return out;
}

/** Every character inside a match of any pattern becomes `*` (whitespace kept), like the native `mask()` helpers. */
export function maskPatterns(text: string, patterns: readonly RegExp[]): string {
  if (patterns.length === 0 || text === "") return text;
  const hit = new Array<boolean>(text.length).fill(false);
  let any = false;
  for (const p of patterns) {
    const re = new RegExp(p.source, p.flags.includes("g") ? p.flags : `${p.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      for (let i = m.index; i < m.index + m[0].length; i++) {
        hit[i] = true;
        any = true;
      }
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  if (!any) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    out += hit[i] && !/\s/.test(c) ? "*" : c;
  }
  return out;
}

type Node = { type?: number; textContent?: unknown; attributes?: Record<string, unknown>; childNodes?: unknown[] };

/** A copy of a full-snapshot node tree with the patterns applied to text nodes and input `value` attributes. */
export function maskSnapshotText(node: unknown, patterns: readonly RegExp[]): unknown {
  if (patterns.length === 0 || typeof node !== "object" || node === null) return node;
  const n = node as Node;
  const out: Node = { ...n };
  if (typeof n.textContent === "string") out.textContent = maskPatterns(n.textContent, patterns);
  if (n.attributes && typeof n.attributes.value === "string") out.attributes = { ...n.attributes, value: maskPatterns(n.attributes.value, patterns) };
  if (Array.isArray(n.childNodes)) out.childNodes = n.childNodes.map((c) => maskSnapshotText(c, patterns));
  return out;
}

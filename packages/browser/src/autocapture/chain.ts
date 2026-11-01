export interface ElementInfo {
  tag_name: string;
  nth_child: number;
  nth_of_type: number;
  classes?: string[];
  attr__id?: string;
  href?: string;
  text?: string;
  attrs?: Record<string, string>;
}

const MAX_DEPTH = 10;
const MAX_TEXT = 255;
/** Form controls: their text/value is user input and is never read. */
const NO_TEXT = new Set(["input", "textarea", "select", "option"]);
/** Plain attributes worth keeping; `value` is deliberately absent. */
const KEEP_ATTRS = ["name", "type", "role", "aria-label", "title", "alt", "placeholder"];
/** Digit runs that look like card/SSN numbers are dropped from text. */
const SENSITIVE = /(?:\d[ -]?){9,}/;

function ownText(el: Element): string | undefined {
  if (NO_TEXT.has(el.tagName.toLowerCase()) || (el as HTMLElement).isContentEditable) return undefined;
  let t = "";
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent ?? "";
  t = t.replace(/\s+/g, " ").trim();
  if (!t || SENSITIVE.test(t)) return undefined;
  return t.slice(0, MAX_TEXT);
}

/** Attribute-name matcher: exact names, or a trailing `*` for a prefix (`data-*`). */
export function ignoreMatcher(names: readonly string[] | undefined): (attr: string) => boolean {
  if (!names?.length) return () => false;
  const lower = names.map((n) => n.toLowerCase());
  return (a) => lower.some((n) => (n.endsWith("*") ? a.startsWith(n.slice(0, -1)) : a === n));
}

/** Attribute-value masking: everything but `allow` (same matching as attributeIgnore) reads `***`. */
export interface MaskOptions {
  maskAll?: boolean | undefined;
  allow?: readonly string[] | undefined;
}

export const MASKED = "***";

/** `data-lc-attr-<name>="v"` on the target or an ancestor becomes event property `<name>: "v"` (nearest wins). */
export function attrProps(target: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (let el: Element | null = target, d = 0; el && d < MAX_DEPTH; el = el.parentElement, d++) {
    for (const a of Array.from(el.attributes)) {
      const k = a.name.startsWith("data-lc-attr-") ? a.name.slice(13) : "";
      if (k && !(k in out) && !k.startsWith("$")) out[k] = a.value.slice(0, MAX_TEXT);
    }
  }
  return out;
}

function describe(el: Element, withText: boolean, ignored: (a: string) => boolean, mask: (a: string, v: string) => string): ElementInfo {
  const parent = el.parentElement;
  const sibs = parent ? Array.from(parent.children) : [el];
  const info: ElementInfo = {
    tag_name: el.tagName.toLowerCase(),
    nth_child: sibs.indexOf(el) + 1,
    nth_of_type: sibs.filter((s) => s.tagName === el.tagName).indexOf(el) + 1,
  };
  const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  if (classes.length && !ignored("class")) info.classes = classes;
  if (el.id && !ignored("id")) info.attr__id = mask("id", el.id);
  const href = el.getAttribute("href");
  if (href && !ignored("href")) info.href = mask("href", href.slice(0, 1024));
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if ((a.name.startsWith("data-lc-") || KEEP_ATTRS.includes(a.name)) && !ignored(a.name)) attrs[a.name] = mask(a.name, a.value.slice(0, 255));
  }
  if (Object.keys(attrs).length) info.attrs = attrs;
  if (withText) {
    const t = ownText(el);
    if (t) info.text = t;
  }
  return info;
}

/** Element chain from the target up to <html> (max depth 10). Text only on the first `textDepth` elements. */
export function buildChain(target: Element, captureText: boolean, textUpTo?: Element, ignoreAttrs?: readonly string[], maskOpts: MaskOptions = {}): ElementInfo[] {
  const out: ElementInfo[] = [];
  const ignored = ignoreMatcher(ignoreAttrs);
  const allowed = ignoreMatcher(maskOpts.allow);
  const mask = maskOpts.maskAll ? (a: string, v: string): string => (allowed(a) ? v : MASKED) : (_a: string, v: string): string => v;
  let withText = captureText;
  for (let el: Element | null = target; el && out.length < MAX_DEPTH; el = el.parentElement) {
    out.push(describe(el, withText, ignored, mask));
    if (el === textUpTo || !textUpTo) withText = false; // text for target..interactive ancestor only
  }
  return out;
}

const q = (s: string): string => s.replace(/(["\\])/g, "\\$1");

/** Compact single-string form: tag.class:attr__id="x"nth-child="1"..., elements joined by ';'. */
export function chainToString(chain: ElementInfo[]): string {
  return chain
    .map((e) => {
      let s = e.tag_name + (e.classes ? "." + e.classes.join(".") : "") + ":";
      if (e.attr__id) s += `attr__id="${q(e.attr__id)}"`;
      if (e.href) s += `href="${q(e.href)}"`;
      if (e.text) s += `text="${q(e.text)}"`;
      for (const [k, v] of Object.entries(e.attrs ?? {})) s += `attr__${k}="${q(v)}"`;
      return s + `nth-child="${e.nth_child}"nth-of-type="${e.nth_of_type}"`;
    })
    .join(";");
}

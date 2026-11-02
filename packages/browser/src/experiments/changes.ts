import { styleTag } from "../csp.js";
import { safeImageUrl, sanitizeHtml } from "./sanitize.js";

/** One visual-editor change against a CSS selector (stored as JSON on the variant payload). `url`
 * (contains) limits it to some pages, so one variant can change several pages (multipage, LC-EXT-33). */
export type Change = { url?: string } & (
  | { selector: string; type: "text"; value: string }
  | { selector: string; type: "attr"; name: string; value: string | null }
  | { selector: string; type: "style"; styles: Record<string, string> }
  | { selector: string; type: "hide" }
  /** Move the element to child position `index` of its parent. */
  | { selector: string; type: "reorder"; index: number }
  /** Insert sanitized HTML relative to the element (see sanitize.ts); applied once per element. Served only with `approved`. */
  | { selector: string; type: "insert"; position: InsertPosition; html: string; approved?: boolean }
  /** Swap an image (an uploaded asset or any http(s) URL). */
  | { selector: string; type: "image"; src: string; srcset?: string; alt?: string }
  /** Page-level custom CSS (added once, with the configured CSP nonce). Served only with `approved`. */
  | { selector?: string; type: "css"; css: string; approved?: boolean }
  /**
   * Page-level custom JS: runs only when the server stamped `approved: true` (the project's
   * `experiment.custom_code` approval) AND the site opted in with `visualChanges.allowCustomJs`.
   */
  | { selector?: string; type: "js"; js: string; approved?: boolean }
);

export type InsertPosition = "before" | "after" | "prepend" | "append";

/** Options for {@link applyChanges}. */
export interface ApplyOptions {
  /** CSP nonce for injected `<style>` / `<script>` elements. */
  nonce?: string | undefined;
  /** Run approved `js` changes (default false). */
  allowJs?: boolean | undefined;
  /**
   * Serving path: page CSS, inserted HTML and JS run only with the server's approval stamp (`approved: true`,
   * set when the project's `experiment.custom_code` policy allows or an approver approved the code). The
   * visual editor previews its own unsaved changes without it.
   */
  requireApproval?: boolean | undefined;
}

/** Payload key holding the change list on a flag / variant payload. */
export const CHANGES_KEY = "lc_changes";
/** Attribute marking DOM the SDK inserted for a change (idempotent re-apply, editor clean-up). */
export const CHANGE_MARKER = "data-lc-change";

const UNSAFE_ATTR = /^on/i;
const UNSAFE_URL = /^\s*(javascript|data|vbscript):/i;
const PAGE_LEVEL = new Set(["css", "js"]);
const POSITIONS = new Set<string>(["before", "after", "prepend", "append"]);
/** On an element that received insert changes: their ids, so re-applying never duplicates. */
const TARGET_MARKER = "data-lc-inserted";

/** Stable short id of a change's content (djb2), used as its DOM marker. */
export function changeId(c: Change): string {
  const s = JSON.stringify(c);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `c${(h >>> 0).toString(36)}`;
}

/** Pull a well-formed change list out of a flag payload (anything else yields []); with `href`, only the changes for that page. */
export function changesOf(payload: unknown, href?: string): Change[] {
  const list = (payload as Record<string, unknown> | null | undefined)?.[CHANGES_KEY];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (c): c is Change =>
      !!c &&
      typeof c === "object" &&
      typeof (c as Change).type === "string" &&
      (typeof (c as Change).selector === "string" || PAGE_LEVEL.has((c as Change).type)) &&
      (href === undefined || !(c as Change).url || href.includes((c as Change).url!)),
  );
}

function insertOne(el: Element, c: Extract<Change, { type: "insert" }>): void {
  const id = changeId(c);
  const done = (el.getAttribute(TARGET_MARKER) ?? "").split(" ").filter(Boolean);
  if (done.includes(id) || !POSITIONS.has(c.position) || typeof c.html !== "string") return;
  const frag = sanitizeHtml(c.html);
  for (const n of [...frag.children]) n.setAttribute(CHANGE_MARKER, id);
  if (c.position === "before") el.before(frag);
  else if (c.position === "after") el.after(frag);
  else if (c.position === "prepend") el.prepend(frag);
  else el.append(frag);
  el.setAttribute(TARGET_MARKER, [...done, id].join(" "));
}

const safeSrcset = (v: string): boolean => v.split(",").every((x) => safeImageUrl(x.trim().split(/\s+/)[0] ?? ""));

function imageOne(el: Element, c: Extract<Change, { type: "image" }>): void {
  const tag = el.tagName.toUpperCase();
  if (typeof c.src !== "string" || !safeImageUrl(c.src)) return;
  if (tag === "SOURCE") {
    el.setAttribute("srcset", c.src);
    return;
  }
  if (tag !== "IMG") return;
  el.setAttribute("src", c.src);
  // A stale srcset would win over the new src, so it is replaced or dropped.
  if (c.srcset && safeSrcset(c.srcset)) el.setAttribute("srcset", c.srcset);
  else el.removeAttribute("srcset");
  if (typeof c.alt === "string") el.setAttribute("alt", c.alt);
}

/** Page-level CSS or JS, added once (by content id) to `<head>`. */
function pageCode(c: Extract<Change, { type: "css" | "js" }>, o: ApplyOptions, doc: Document): void {
  const id = changeId(c);
  if (doc.querySelector(`[${CHANGE_MARKER}="${id}"]`)) return;
  let el: HTMLElement;
  if (c.type === "css") {
    if (typeof c.css !== "string") return;
    el = doc.importNode(styleTag(c.css, o.nonce), true);
  } else {
    if (c.approved !== true || !o.allowJs || typeof c.js !== "string") return;
    el = doc.createElement("script");
    if (o.nonce) el.setAttribute("nonce", o.nonce);
    el.textContent = c.js;
  }
  el.setAttribute(CHANGE_MARKER, id);
  doc.head.append(el);
}

function applyOne(el: Element, c: Change): void {
  const h = el as HTMLElement;
  switch (c.type) {
    case "text":
      el.textContent = c.value; // textContent only: change values are data, never markup
      break;
    case "attr":
      if (UNSAFE_ATTR.test(c.name) || (typeof c.value === "string" && /^(href|src|action|formaction)$/i.test(c.name) && UNSAFE_URL.test(c.value))) break;
      if (c.value === null) el.removeAttribute(c.name);
      else el.setAttribute(c.name, c.value);
      break;
    case "style":
      for (const [k, v] of Object.entries(c.styles)) h.style.setProperty(k, v);
      break;
    case "hide":
      h.style.setProperty("display", "none", "important");
      break;
    case "insert":
      insertOne(el, c);
      break;
    case "image":
      imageOne(el, c);
      break;
    case "reorder": {
      const p = el.parentElement;
      if (!p) break;
      const kids = [...p.children].filter((x) => x !== el);
      const at = Math.max(0, Math.min(c.index, kids.length));
      p.insertBefore(el, kids[at] ?? null);
      break;
    }
  }
}

/**
 * Apply `changes` under `root`. Idempotent (re-applying yields the same DOM). Returns the changes whose
 * selector matched nothing (yet) so the caller can retry as the page renders; a bad selector is skipped.
 * Page-level `css` / `js` changes are added to `<head>` once; `js` needs `opts.allowJs` and server approval;
 * with `opts.requireApproval` an unstamped css / insert / js change is refused outright.
 */
export function applyChanges(changes: Change[], root: ParentNode = document, opts: ApplyOptions = {}): Change[] {
  const missing: Change[] = [];
  for (const c of changes) {
    if (opts.requireApproval && (c.type === "css" || c.type === "js" || c.type === "insert") && c.approved !== true) continue;
    if (c.type === "css" || c.type === "js") {
      const doc = (root as Node).nodeType === 9 ? (root as Document) : (root as Node).ownerDocument;
      if (doc?.head) pageCode(c, opts, doc);
      continue;
    }
    let found: Element[];
    try {
      found = [...root.querySelectorAll(c.selector)];
    } catch {
      continue;
    }
    if (!found.length) missing.push(c);
    for (const el of found) applyOne(el, c);
  }
  return missing;
}

/** Remove what the SDK inserted for changes (inserted HTML, page CSS / JS elements): the editor's preview reset. */
export function removeInserted(root: ParentNode = document): void {
  for (const el of [...root.querySelectorAll(`[${CHANGE_MARKER}]`)]) el.remove();
  for (const el of [...root.querySelectorAll(`[${TARGET_MARKER}]`)]) el.removeAttribute(TARGET_MARKER);
}

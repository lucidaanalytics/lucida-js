/** One visual-editor change against a CSS selector (stored as JSON on the variant payload). `url`
 * (contains) limits it to some pages, so one variant can change several pages (multipage, LC-EXT-33). */
export type Change = { url?: string } & (
  | { selector: string; type: "text"; value: string }
  | { selector: string; type: "attr"; name: string; value: string | null }
  | { selector: string; type: "style"; styles: Record<string, string> }
  | { selector: string; type: "hide" }
  /** Move the element to child position `index` of its parent. */
  | { selector: string; type: "reorder"; index: number }
);

/** Payload key holding the change list on a flag / variant payload. */
export const CHANGES_KEY = "lc_changes";

const UNSAFE_ATTR = /^on/i;
const UNSAFE_URL = /^\s*(javascript|data|vbscript):/i;

/** Pull a well-formed change list out of a flag payload (anything else yields []); with `href`, only the changes for that page. */
export function changesOf(payload: unknown, href?: string): Change[] {
  const list = (payload as Record<string, unknown> | null | undefined)?.[CHANGES_KEY];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (c): c is Change =>
      !!c && typeof c === "object" && typeof (c as Change).selector === "string" && typeof (c as Change).type === "string" && (href === undefined || !(c as Change).url || href.includes((c as Change).url!)),
  );
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
 */
export function applyChanges(changes: Change[], root: ParentNode = document): Change[] {
  const missing: Change[] = [];
  for (const c of changes) {
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

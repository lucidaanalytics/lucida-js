import { stableSelector } from "./guide-draft.js";

/** One outline entry, the input of the AI change-set generator (`go/ai/experiments.PageElement`, P-L3). */
export interface OutlineElement {
  selector: string;
  tag: string;
  text: string;
}

const TARGETS = "h1,h2,h3,button,a,img,[role=button],section[id],header,nav,footer,form label,li";
const MAX = 150;

/**
 * The page outline the AI drafts against: headings, buttons, links, images and landmarks
 * with a stable selector and a short text snapshot. Form values and inputs are never read (labels
 * only), and SDK-inserted or toolbar UI is skipped.
 */
export function pageOutline(root: ParentNode = document): OutlineElement[] {
  const out: OutlineElement[] = [];
  const seen = new Set<string>();
  for (const el of root.querySelectorAll(TARGETS)) {
    if (el.closest("[data-lc-ignore],[data-lc-change]")) continue;
    const selector = stableSelector(el);
    if (seen.has(selector)) continue;
    seen.add(selector);
    const tag = el.tagName.toLowerCase();
    const text = (tag === "img" ? (el.getAttribute("alt") ?? "") : (el.textContent ?? "")).replace(/\s+/g, " ").trim().slice(0, 160);
    out.push({ selector, tag, text });
    if (out.length >= MAX) break;
  }
  return out;
}

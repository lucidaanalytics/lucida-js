/**
 * Fixed-position marker (heatmap clicks): replay streams carry no computed styles, so a header
 * pinned by a stylesheet would look like page content and its clicks would be placed by scroll
 * offset. Every element whose computed `position` is `fixed` or `sticky` gets a `data-lc-fixed`
 * attribute in the snapshot or mutation event (never on the live page); lc-replay reads it.
 */
import { visitAttributes } from "./visit.js";
import type { DomEvent, GetNode } from "./visit.js";

export const FIXED_ATTR = "data-lc-fixed";

export function markFixed(e: DomEvent, getNode: GetNode): void {
  visitAttributes(e, getNode, (attrs, _tag, el) => {
    if (!el || FIXED_ATTR in attrs) return;
    try {
      const pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") attrs[FIXED_ATTR] = "";
    } catch {
      // a detached or cross-realm node: leave it unmarked
    }
  });
}

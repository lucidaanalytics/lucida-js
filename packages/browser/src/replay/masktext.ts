/**
 * Mask-all-text mode (LC-EXP-40): every text node and text-bearing attribute is masked in the
 * browser, except inside an explicit unmask allow-list (`[data-lc-unmask]` plus local
 * `unmask_selectors`). A mask selector inside an unmasked region still wins.
 */
import { visitAttributes } from "./visit.js";
import type { DomEvent, GetNode } from "./visit.js";

/** Attributes that carry user-visible text. Input values are governed by mask_all_inputs. */
const TEXT_ATTRS = ["title", "alt", "placeholder", "aria-label", "aria-description", "aria-placeholder", "aria-roledescription", "aria-valuetext"];
const FORM_TAGS = new Set(["input", "textarea", "select"]);

const star = (t: string): string => t.replace(/\S/g, "*");

export interface TextMasker {
  /** rrweb `maskTextFn`, used with `maskTextSelector: "*"`. */
  maskTextFn(text: string, el: HTMLElement | null): string;
  /** Masks text-bearing attributes of a full snapshot or DOM mutation in place. */
  scrub(e: DomEvent, getNode: GetNode): void;
}

export function textMasker(maskSelector: string, unmaskSelector: string): TextMasker {
  const shown = (el: Element | null | undefined): boolean => {
    try {
      return !!el?.closest(unmaskSelector) && !el.closest(maskSelector);
    } catch {
      return false; // a bad selector fails closed
    }
  };
  const maskAttrs = (attrs: Record<string, unknown>, tag: string, el: Element | null): void => {
    if (shown(el)) return;
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      const text = TEXT_ATTRS.includes(k) || (k === "value" && !FORM_TAGS.has(tag));
      if (text && typeof v === "string") attrs[k] = star(v);
    }
  };
  return {
    maskTextFn: (text, el) => (shown(el) ? text : star(text)),
    scrub: (e, getNode) => visitAttributes(e, getNode, maskAttrs),
  };
}

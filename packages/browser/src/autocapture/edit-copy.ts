import type { AutocaptureConfig, Host } from "../types.js";
import { attrProps, buildChain, chainToString } from "./chain.js";
import { hidden, maskOptions } from "./events.js";

const EDITABLE = '[contenteditable]:not([contenteditable="false"])';
const FORM = "input,textarea,select";
const MAX_COPIED = 255;

/** Copied text as sent with `captureCopiedText`: digit runs (cards, phones) and emails masked, whitespace folded, cut to 255. */
export function maskCopied(t: string): string {
  return t
    .replace(/\d(?:[ -]?\d){5,}/g, "***")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COPIED);
}

const elementOf = (n: Node | null | undefined): Element | null => (!n ? null : n instanceof Element ? n : n.parentElement);

/**
 * `contenteditable` regions: an edit is reported once, when focus leaves the region, as `$autocapture` change with the
 * element chain only (never the content). Copy / cut (opt-in `copyCut`): `$copy_autocapture` with `$copy_type`; the
 * selected text only with `captureCopiedText`, masked. Nothing inside form controls, ignored or denied areas is seen.
 */
export function startEditCopyCapture(host: Host, cfg: AutocaptureConfig, enabled: () => boolean, editsEnabled: () => boolean = () => true): () => void {
  const events = cfg.events ?? ["click", "change", "submit"];
  const edits = cfg.contentEditable !== false && events.includes("change");
  const dirty = new WeakSet<Element>();
  const chainProps = (el: Element) => {
    const chain = buildChain(el, false, el, cfg.attributeIgnore, maskOptions(cfg));
    return { ...attrProps(el), $elements: chain, $elements_chain: chainToString(chain) };
  };
  const root = (t: EventTarget | null): Element | null => {
    const el = t instanceof Element ? t.closest(EDITABLE) : null;
    return el && !hidden(el, cfg) ? el : null;
  };
  const onInput = (ev: Event): void => {
    const r = enabled() && editsEnabled() ? root(ev.target) : null;
    if (r) dirty.add(r);
  };
  const onLeave = (ev: FocusEvent): void => {
    const r = root(ev.target);
    if (!r || !dirty.has(r) || (ev.relatedTarget instanceof Node && r.contains(ev.relatedTarget))) return;
    dirty.delete(r);
    if (enabled() && editsEnabled()) host.client.capture("$autocapture", { $event_type: "change", $el_contenteditable: true, ...chainProps(r) });
  };
  const onCopy = (ev: Event): void => {
    if (!enabled() || !cfg.copyCut) return;
    const sel = typeof getSelection === "function" ? getSelection() : null;
    const t = ev.target instanceof Element ? ev.target : null;
    const el = elementOf(sel?.anchorNode) ?? t;
    if (!el || hidden(el, cfg) || el.closest(FORM) || t?.closest(FORM)) return;
    const text = cfg.captureCopiedText ? maskCopied(sel?.toString() ?? "") : "";
    host.client.capture("$copy_autocapture", { $copy_type: ev.type, ...chainProps(el), ...(text ? { $selected_content: text } : {}) });
  };
  if (edits) {
    document.addEventListener("input", onInput, true);
    document.addEventListener("focusout", onLeave, true);
  }
  document.addEventListener("copy", onCopy, true);
  document.addEventListener("cut", onCopy, true);
  return () => {
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("focusout", onLeave, true);
    document.removeEventListener("copy", onCopy, true);
    document.removeEventListener("cut", onCopy, true);
  };
}

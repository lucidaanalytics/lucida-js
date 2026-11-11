import type { AutocaptureConfig, Host } from "../types.js";
import { attrProps, buildChain, chainToString } from "./chain.js";
import type { MaskOptions } from "./chain.js";
import { clickProps } from "./click.js";

const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[role=link],[data-lc-capture]";
export const IGNORE = "[data-lc-ignore]";

/** True when the current page URL matches one of the patterns (substring or RegExp). */
export const urlMatches = (list: ReadonlyArray<string | RegExp>): boolean =>
  list.some((p) => (typeof p === "string" ? location.href.includes(p) : p.test(location.href)));

const urlAllowed = (list: Array<string | RegExp> | undefined): boolean => !list?.length || urlMatches(list);

export const maskOptions = (cfg: AutocaptureConfig): MaskOptions => ({ maskAll: cfg.maskAllAttributes, allow: cfg.attributeAllowlist });

/** Ignored ([data-lc-ignore]) or inside a deny selector: invisible to every autocapture listener. */
export const hidden = (el: Element, cfg: AutocaptureConfig): boolean =>
  !!el.closest(IGNORE) || !!(cfg.denySelectors?.length && el.closest(cfg.denySelectors.join(",")));

/**
 * Click / change / submit autocapture. Never reads input values; text of form controls is
 * skipped; anything inside [data-lc-ignore] or a deny selector is invisible to the SDK. Key presses are only
 * counted (never which key) and the count rides on the next autocapture event as `$keystroke_count`; password
 * fields and ignored or denied areas are not counted. `inputsEnabled` false (remote `autocapture_inputs`) drops
 * change / submit events and key counting; clicks stay.
 */
export function startEventCapture(host: Host, cfg: AutocaptureConfig, enabled: () => boolean, inputsEnabled: () => boolean = () => true): () => void {
  const events = cfg.events ?? ["click", "change", "submit"];
  let keystrokes = 0;
  const onKey = (ev: KeyboardEvent): void => {
    const target = ev.target;
    if (!enabled() || !inputsEnabled() || ev.isComposing || !(target instanceof Element) || hidden(target, cfg)) return;
    if (target instanceof HTMLInputElement && target.type === "password") return;
    keystrokes += 1;
  };

  const handle = (type: "click" | "change" | "submit") => (ev: Event): void => {
    if (!enabled() || (type !== "click" && !inputsEnabled())) return;
    const target = ev.target;
    if (!(target instanceof Element) || hidden(target, cfg)) return;
    if (cfg.allowSelectors?.length && !target.closest(cfg.allowSelectors.join(","))) return;
    if (cfg.elementAllowlist?.length && !target.closest(cfg.elementAllowlist.join(","))) return;
    if (!urlAllowed(cfg.urlAllowlist)) return;
    if (type === "change" && !/^(input|select|textarea)$/i.test(target.tagName)) return;
    if (target instanceof HTMLInputElement && target.type === "password") return;
    // Clicks only count when they land on (or inside) something interactive, unless explicitly allowed.
    const interactive = target.closest(INTERACTIVE);
    if (type === "click" && !interactive && !cfg.allowSelectors?.length) return;
    const chain = buildChain(target, cfg.captureText ?? true, interactive ?? undefined, cfg.attributeIgnore, maskOptions(cfg));
    const text = chain.find((e) => e.text)?.text;
    const keys = keystrokes;
    keystrokes = 0;
    host.client.capture("$autocapture", {
      ...attrProps(target),
      $event_type: type,
      ...(keys > 0 ? { $keystroke_count: keys } : {}),
      $elements: chain,
      $elements_chain: chainToString(chain),
      ...(text ? { $el_text: text } : {}),
      ...(type === "click" ? clickProps(host, ev as MouseEvent, target, !!interactive, cfg) : {}),
    });
  };

  host.autocaptureClicks = events.includes("click");
  const handlers = events.map((t) => [t, handle(t)] as const);
  for (const [t, h] of handlers) document.addEventListener(t, h, true);
  document.addEventListener("keydown", onKey, true);
  return () => {
    for (const [t, h] of handlers) document.removeEventListener(t, h, true);
    document.removeEventListener("keydown", onKey, true);
  };
}

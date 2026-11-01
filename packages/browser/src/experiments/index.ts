import { styleTag } from "../csp.js";
import type { Host, Module } from "../types.js";
import { applyChanges, changesOf } from "./changes.js";

export { applyChanges, changesOf, CHANGES_KEY } from "./changes.js";
export type { Change } from "./changes.js";
export { splitUrl, splitTarget, SPLIT_URL_KEY, SPLIT_MARKER } from "./split-url.js";

const RETRY_MS = 5000;

/**
 * Visual-editor experiments and personalization (LC-EXT-16). A flag whose (variant) payload carries
 * `lc_changes` has those DOM changes applied for the assigned value: an experiment flag by its
 * variant payload, personalization by a plain flag whose release conditions target the audience.
 * Changes whose selector is not rendered yet are retried on DOM mutations for 5 s. A change with a
 * `url` applies only on matching pages (multipage tests); SPA page views re-apply the set.
 * `visualChanges.antiFlickerMs` hides the page until flags resolve (or the timeout) to avoid a flash
 * of the control; 0 (default) never hides it.
 */
export const visualChanges: Module = (host: Host) => {
  if (typeof document === "undefined") return;
  const timeout = host.config.visualChanges?.antiFlickerMs ?? 0;
  let veil: HTMLStyleElement | undefined;
  const lift = (): void => {
    veil?.remove();
    veil = undefined;
  };
  if (timeout > 0) {
    veil = styleTag("html{opacity:0 !important}", host.config.nonce);
    document.head.append(veil);
    setTimeout(lift, timeout);
  }
  let observer: MutationObserver | undefined;
  let stopRetry: ReturnType<typeof setTimeout> | undefined;
  const run = (f: Record<string, unknown>): void => {
    observer?.disconnect();
    clearTimeout(stopRetry);
    let pending = Object.keys(f).flatMap((k) => {
      const c = changesOf(host.flags?.payload(k), location.href);
      if (c.length) host.flags?.get(k); // reading the flag records the $exposure for experiment analysis
      return c;
    });
    pending = applyChanges(pending);
    lift();
    if (!pending.length || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(() => {
      pending = applyChanges(pending);
      if (!pending.length) observer?.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    stopRetry = setTimeout(() => observer?.disconnect(), RETRY_MS);
  };
  let last: Record<string, unknown> | undefined;
  const off = host.client.onFlags((f) => run((last = f)));
  host.onCapture((e) => {
    if (e.event === "$pageview" && last) run(last); // SPA navigation: this page's changes
  });
  return () => {
    off();
    observer?.disconnect();
    clearTimeout(stopRetry);
    lift();
  };
};

import { styleTag } from "../csp.js";
import type { Host, Module } from "../types.js";
import { applyChanges, changesOf } from "./changes.js";
import type { Change } from "./changes.js";
import { matches, triggerOf, triggerWatch } from "./triggers.js";
import type { TriggerGroup } from "./triggers.js";

export { applyChanges, changeId, changesOf, removeInserted, CHANGE_MARKER, CHANGES_KEY } from "./changes.js";
export type { ApplyOptions, Change, InsertPosition } from "./changes.js";
export { safeImageUrl, sanitizeHtml } from "./sanitize.js";
export { splitUrl, splitTarget, SPLIT_URL_KEY, SPLIT_MARKER } from "./split-url.js";
export { matches as triggerMatches, triggerOf, TRIGGER_KEY } from "./triggers.js";
export type { TriggerCondition, TriggerFacts, TriggerGroup } from "./triggers.js";

const RETRY_MS = 5000;

/**
 * Visual-editor experiments and personalization (LC-EXT-16). A flag whose (variant) payload carries
 * `lc_changes` has those DOM changes applied for the assigned value: an experiment flag by its
 * variant payload, personalization by a plain flag whose release conditions target the audience.
 * Changes whose selector is not rendered yet are retried on DOM mutations for 5 s. A change with a
 * `url` applies only on matching pages (multipage tests); SPA page views re-apply the set.
 * `visualChanges.antiFlickerMs` hides the page until flags resolve (or the timeout) to avoid a flash
 * of the control; 0 (default) never hides it. Inserted HTML is sanitized; page CSS carries the CSP
 * `nonce`; page CSS, inserted HTML and JS are served only with the server's approval stamp, and JS
 * also needs `visualChanges.allowCustomJs`.
 *
 * Activation triggers (N-EXP-6): a payload with `lc_trigger` (on every variant, control included)
 * defers both the changes and the `$exposure` until the trigger matches (time on page or in session,
 * pages viewed, scroll depth, exit intent, an element in view, a custom event, `manual`, AND / OR).
 * Once activated, the flag stays active for the session. `client.activateExperiment(flagKey)` forces
 * activation (and re-applies the changes, for SPAs that re-render).
 */
export const visualChanges: Module = (host: Host) => {
  if (typeof document === "undefined") return;
  const timeout = host.config.visualChanges?.antiFlickerMs ?? 0;
  const opts = { nonce: host.config.nonce, allowJs: host.config.visualChanges?.allowCustomJs === true, requireApproval: true };
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
  const watch = triggerWatch(host);
  let observer: MutationObserver | undefined;
  let stopRetry: ReturnType<typeof setTimeout> | undefined;
  let missing: Change[] = [];
  const stop = (): void => {
    observer?.disconnect();
    clearTimeout(stopRetry);
  };
  /** Apply now; what is not rendered yet is retried on DOM mutations for RETRY_MS. */
  const applyNow = (list: Change[]): void => {
    missing = [...missing, ...applyChanges(list, document, opts)];
    if (!missing.length || typeof MutationObserver === "undefined") return;
    observer ??= new MutationObserver(() => {
      missing = applyChanges(missing, document, opts);
      if (!missing.length) stop();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    clearTimeout(stopRetry);
    stopRetry = setTimeout(stop, RETRY_MS);
  };
  /** `activateExperiment` forces activation; otherwise the trigger decides. */
  const due = (k: string, t: TriggerGroup): boolean => {
    const f = watch.facts(k);
    return f.manual || matches(t, f);
  };
  /** Flags whose trigger has not matched yet on this page. */
  const waiting = new Map<string, TriggerGroup>();
  const activate = (k: string): Change[] => {
    watch.fire(k);
    host.flags?.get(k); // reading the flag records the $exposure for experiment analysis
    return changesOf(host.flags?.payload(k), location.href);
  };
  const run = (f: Record<string, unknown>): void => {
    stop();
    missing = [];
    waiting.clear();
    const ready: Change[] = [];
    for (const k of Object.keys(f)) {
      const p = host.flags?.payload(k);
      const t = triggerOf(p);
      if (!t) {
        const c = changesOf(p, location.href);
        if (c.length) host.flags?.get(k);
        ready.push(...c);
      } else if (watch.fired(k) || due(k, t)) ready.push(...activate(k));
      else waiting.set(k, t);
    }
    applyNow(ready);
    lift(); // a deferred experiment shows the page as it is until its trigger fires
    watch.sense(waiting.size > 0);
  };
  watch.onChange(() => {
    if (!waiting.size) return;
    const ready: Change[] = [];
    for (const [k, t] of [...waiting]) {
      if (!due(k, t)) continue;
      waiting.delete(k);
      ready.push(...activate(k));
    }
    if (ready.length) applyNow(ready);
    if (!waiting.size) watch.sense(false);
  });
  let last: Record<string, unknown> | undefined;
  const off = host.client.onFlags((f) => run((last = f)));
  host.onCapture((e) => {
    if (e.event === "$pageview" && last) run(last); // SPA navigation: this page's changes
  });
  host.experiments = {
    activate(key) {
      watch.activate(key);
      if (last && !waiting.has(key)) run(last); // already active: re-apply after an SPA re-render
    },
  };
  return () => {
    off();
    stop();
    watch.dispose();
    lift();
  };
};

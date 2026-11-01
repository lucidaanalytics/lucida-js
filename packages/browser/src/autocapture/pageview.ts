import type { Host } from "../types.js";
import { engagementTimer } from "./engagement.js";

/** Tracks the deepest point of the page the viewport has reached. */
function scrollTracker(): { read(): { pct: number; px: number }; stop(): void } {
  let px = 0;
  let pct = 0;
  const update = (): void => {
    const de = document.documentElement;
    const height = Math.max(de.scrollHeight, document.body?.scrollHeight ?? 0);
    const bottom = Math.min(height, (window.scrollY || window.pageYOffset || 0) + window.innerHeight);
    if (bottom > px) {
      px = bottom;
      pct = height > 0 ? Math.min(100, Math.round((bottom / height) * 100)) : 0;
    }
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
  return {
    read: () => ({ pct, px }),
    stop: () => window.removeEventListener("scroll", update),
  };
}

/**
 * $pageview on load and (mode 'history') on pushState/replaceState/popstate; $pageleave with
 * $scroll_depth (max %), $scroll_depth_px and $engagement_time_ms (visible time) when leaving a page, SPA route or real unload.
 */
export function startPageviews(host: Host, mode: "history" | boolean, parts: { views?: boolean; leave?: boolean } = {}): () => void {
  const views = parts.views ?? true;
  const leaves = parts.leave ?? true;
  let url = location.href;
  let scroll = scrollTracker();
  const engaged = engagementTimer();
  let leftUrl: string | undefined;

  const leave = (): void => {
    if (!leaves || leftUrl === url) return;
    leftUrl = url;
    const { pct, px } = scroll.read();
    host.client.capture("$pageleave", { $current_url: url, $scroll_depth: pct, $scroll_depth_px: px, $engagement_time_ms: engaged.read() });
  };

  // A pageview the consent gate would drop is re-fired (for the current URL) once analytics is granted.
  let pending = false;
  const view = (referrer?: string): void => {
    if (!views) return;
    const { core } = host;
    if (!core.hasConsent("analytics") && !core.anonymousOnReject && !(core.consent.pending && core.consent.queueBeforeConsent)) {
      if (!pending) {
        pending = true;
        const fire = (): void => {
          if (!pending) return;
          pending = false;
          view();
        };
        host.whenConsented(fire);
        // cookielessOnReject: a decline also releases the held pageview, sent anonymously.
        core.onChange((c) => {
          if (c === "consent" && core.anonymousOnReject) fire();
        });
      }
      return;
    }
    host.client.capture("$pageview", referrer === undefined ? {} : { $referrer: referrer });
  };

  const navigated = (): void => {
    if (location.href === url) return;
    const prev = url;
    leave();
    scroll.stop();
    url = location.href;
    scroll = scrollTracker();
    engaged.reset();
    view(prev);
  };

  host.onUnload(leave);
  view();
  if (mode !== "history") return () => (scroll.stop(), engaged.stop());

  const { pushState, replaceState } = history;
  history.pushState = function (...a: Parameters<History["pushState"]>) {
    pushState.apply(this, a);
    navigated();
  };
  history.replaceState = function (...a: Parameters<History["replaceState"]>) {
    replaceState.apply(this, a);
    navigated();
  };
  window.addEventListener("popstate", navigated);
  return () => {
    history.pushState = pushState;
    history.replaceState = replaceState;
    window.removeEventListener("popstate", navigated);
    scroll.stop();
    engaged.stop();
  };
}

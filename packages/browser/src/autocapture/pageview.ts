import type { Host } from "../types.js";
import { engagementTimer } from "./engagement.js";
import { hasPageviewRules, pageviewSnapshot, snapshotWait } from "./snapshot-props.js";

const safePath = (u: string): string => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

/** The element that scrolls, for apps whose page is a fixed shell with an inner scroll container. First selector that matches wins. */
function scrollRootEl(sel: string | string[] | undefined): Element | undefined {
  for (const q of sel === undefined ? [] : Array.isArray(sel) ? sel : [sel]) {
    try {
      const el = document.querySelector(q);
      if (el) return el;
    } catch {
      /* bad selector: try the next */
    }
  }
  return undefined;
}

/** Tracks the deepest point of the page (or of `scrollRoot`) the viewport has reached; resizes and inner scrollers count too. */
function scrollTracker(scrollRoot?: string | string[]): { read(): { pct: number; px: number }; stop(): void } {
  let px = 0;
  let pct = 0;
  const update = (): void => {
    const root = scrollRootEl(scrollRoot);
    const de = document.documentElement;
    const height = root ? root.scrollHeight : Math.max(de.scrollHeight, document.body?.scrollHeight ?? 0);
    const top = root ? root.scrollTop : window.scrollY || window.pageYOffset || 0;
    const bottom = Math.min(height, top + (root ? root.clientHeight : window.innerHeight));
    if (bottom > px) {
      px = bottom;
      pct = height > 0 ? Math.min(100, Math.round((bottom / height) * 100)) : 0;
    }
  };
  update();
  // capture: scroll does not bubble, so a scroll container inside the page is only seen this way
  window.addEventListener("scroll", update, { passive: true, capture: true });
  window.addEventListener("resize", update, { passive: true });
  return {
    read: () => ({ pct, px }),
    stop: () => {
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    },
  };
}

const SNAPSHOT_WAIT_MS = 800;

/** Only a pageview that would be captured now is worth holding: the consent gate otherwise re-fires it later. */
const hasHeldAnalytics = (host: Host): boolean => host.core.hasConsent("analytics");

type Watch = { path?: boolean; search?: boolean; hash?: boolean };

/** Which URL parts count as a new page: 'history' = path + query (an in-page anchor is not a page), 'hash' = all three. */
function watched(mode: "history" | "hash" | boolean | Watch): Watch | undefined {
  return mode === "history" ? { path: true, search: true } : mode === "hash" ? { path: true, search: true, hash: true } : typeof mode === "object" ? mode : undefined;
}

function differs(from: string, to: string, w: Watch): boolean {
  try {
    const a = new URL(from);
    const b = new URL(to);
    return !!((w.path && a.pathname !== b.pathname) || (w.search && a.search !== b.search) || (w.hash && a.hash !== b.hash));
  } catch {
    return from !== to;
  }
}

/**
 * $pageview on load and (mode 'history' | 'hash') on pushState/replaceState/popstate, plus hashchange in mode 'hash'; $pageleave with
 * $scroll_depth (max %), $scroll_depth_px and $engagement_time_ms (visible time) when leaving a page, SPA route or real unload.
 */
export function startPageviews(host: Host, mode: "history" | "hash" | boolean | Watch, parts: { views?: boolean; leave?: boolean } = {}): () => void {
  const views = parts.views ?? true;
  const leaves = parts.leave ?? true;
  const watch = watched(mode);
  const root = host.config.scrollRoot;
  let url = location.href; // the page last counted as a pageview
  let seen = url; // the last location seen, counted or not
  let shownAt = Date.now();
  let scroll = scrollTracker(root);
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
  const view = (referrer?: string, extra: Record<string, unknown> = {}): void => {
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
    host.client.capture("$pageview", { ...pageviewSnapshot(host), ...(referrer === undefined ? {} : { $referrer: referrer }), ...extra });
  };

  // Routers set document.title right after pushState in the same task: the pageview is captured once that task's
  // synchronous work is done, and earlier if the URL is about to change again, so it keeps the URL it was scheduled for.
  let queued: (() => void) | undefined;
  const flushQueued = (): void => {
    const f = queued;
    queued = undefined;
    f?.();
  };

  const navigated = (how: string): void => {
    if (location.href === seen) return;
    const before = seen;
    seen = location.href;
    if (!watch || !differs(before, seen, watch)) return;
    const prev = url;
    leave();
    scroll.stop();
    const left = new Date(shownAt);
    url = location.href;
    shownAt = Date.now();
    scroll = scrollTracker(root);
    engaged.reset();
    const extra = {
      $navigation_type: how,
      $prev_pageview_pathname: safePath(prev),
      $prev_pageview_duration: Math.round((shownAt - left.getTime()) / 100) / 10,
    };
    // snapshot properties read the new route, which most routers render right after pushState
    if (hasPageviewRules(host)) setTimeout(() => view(prev, extra), 0);
    else {
      flushQueued();
      queued = () => view(prev, extra);
      queueMicrotask(flushQueued);
    }
  };

  host.onUnload(leave);
  // The first pageview waits briefly for the remote snapshot rules so it carries them; a route change or unload releases it early.
  const hold = hasHeldAnalytics(host) ? snapshotWait(host, SNAPSHOT_WAIT_MS) : undefined;
  if (hold) {
    queued = () => view();
    host.onUnload(flushQueued);
    void hold.then(flushQueued);
  } else view();
  if (!watch) return () => (scroll.stop(), engaged.stop());

  const { pushState, replaceState } = history;
  history.pushState = function (...a: Parameters<History["pushState"]>) {
    flushQueued();
    pushState.apply(this, a);
    navigated("pushState");
  };
  history.replaceState = function (...a: Parameters<History["replaceState"]>) {
    flushQueued();
    replaceState.apply(this, a);
    navigated("replaceState");
  };
  const onPop = (): void => navigated("popstate");
  const onHash = (): void => navigated("hashchange");
  window.addEventListener("popstate", onPop);
  // popstate usually fires too for fragment navigation; navigated() dedupes by URL so the pair never double-counts.
  if (watch.hash) window.addEventListener("hashchange", onHash);
  return () => {
    window.removeEventListener("hashchange", onHash);
    history.pushState = pushState;
    history.replaceState = replaceState;
    window.removeEventListener("popstate", onPop);
    scroll.stop();
    engaged.stop();
  };
}

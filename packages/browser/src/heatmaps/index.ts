import type { Props } from "@lucida-analytics/sdk-core";
import { buildChain, chainToString } from "../autocapture/chain.js";
import { clickProps, cssSelector } from "../autocapture/click.js";
import type { Host, Module } from "../types.js";
import { attentionTracker } from "./attention.js";

const IGNORE = "[data-lc-ignore]";
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role=button],[role=link],[data-lc-capture]";

export type ViewportBucket = "mobile" | "tablet" | "desktop";

export function viewportBucket(width: number): ViewportBucket {
  return width < 768 ? "mobile" : width < 1024 ? "tablet" : "desktop";
}

/** Element-relative click offset plus viewport bucket; merged into every autocaptured click. */
export function heatmapProps(ev: MouseEvent, el: Element): Props {
  const r = el.getBoundingClientRect();
  return {
    $click_el_x: Math.round(ev.clientX - r.left),
    $click_el_y: Math.round(ev.clientY - r.top),
    $el_width: Math.round(r.width),
    $el_height: Math.round(r.height),
    $viewport_bucket: viewportBucket(window.innerWidth),
  };
}

/** True when the element or an ancestor is fixed or sticky: it stays in the viewport while the page scrolls. */
export function pinned(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === "fixed" || p === "sticky") return true;
  }
  return false;
}

/**
 * Batches sampled pointer positions into `$heatmap_moves` events as `[x, y, dt_ms]`, page-relative px.
 * Over a fixed/sticky element the point is viewport-relative and carries a 4th entry `1` (`fixed`):
 * consumers must not add scroll offset to it.
 */
function trackMoves(host: Host, every: number): () => void {
  let pts: Array<[number, number, number] | [number, number, number, 1]> = [];
  let t0 = 0;
  let last = 0;
  const send = (): void => {
    if (!pts.length) return;
    host.client.capture("$heatmap_moves", { $points: pts, $viewport_bucket: viewportBucket(window.innerWidth), $viewport_width: window.innerWidth, $viewport_height: window.innerHeight });
    pts = [];
  };
  const on = (ev: MouseEvent): void => {
    const now = Date.now();
    if (now - last < every || (ev.target instanceof Element && ev.target.closest(IGNORE))) return;
    if (!pts.length) t0 = now;
    last = now;
    const fixed = ev.target instanceof Element && pinned(ev.target);
    const x = Math.round(ev.clientX + (fixed ? 0 : scrollX));
    const y = Math.round(ev.clientY + (fixed ? 0 : scrollY));
    pts.push(fixed ? [x, y, now - t0, 1] : [x, y, now - t0]);
    if (pts.length >= 100) send();
  };
  document.addEventListener("mousemove", on, { passive: true, capture: true });
  const timer = setInterval(send, 5000);
  host.onUnload(send);
  return () => {
    document.removeEventListener("mousemove", on, true);
    clearInterval(timer);
    send();
  };
}

const WATCH = "h1,h2,h3,section,article,main,form,[data-lc-attention]";
const MAX_WATCHED = 200;

/** Batched `$attention` events: visible time per scroll band and per watched element (LC-EXP-20). */
function trackAttention(host: Host): () => void {
  const tr = attentionTracker({
    now: Date.now,
    scrollY: () => window.scrollY,
    viewportH: () => window.innerHeight,
    pageH: () => document.documentElement.scrollHeight,
    visible: () => document.visibilityState !== "hidden",
  });
  const sels = new WeakMap<Element, string>();
  const io =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const sel = sels.get(e.target);
              if (sel) (e.isIntersecting ? tr.enter(sel) : tr.leave(sel));
            }
          },
          { threshold: 0.5 },
        );
  for (const e of [...document.querySelectorAll(WATCH)].slice(0, MAX_WATCHED)) {
    if (e.closest(IGNORE)) continue;
    sels.set(e, cssSelector(e));
    io?.observe(e);
  }
  const send = (): void => {
    const b = tr.drain();
    if (b.bands.length || b.elements.length) {
      host.client.capture("$attention", { $bands: b.bands, $elements: b.elements, $viewport_bucket: viewportBucket(window.innerWidth) });
    }
  };
  const tick = setInterval(() => tr.tick(), 1000);
  const flush = setInterval(send, 15000);
  host.onUnload(() => (tr.tick(), send()));
  return () => {
    clearInterval(tick);
    clearInterval(flush);
    io?.disconnect();
    tr.tick();
    send();
  };
}

/**
 * Heatmap capture. Interactive clicks are captured by autocapture and decorated here with
 * element-relative offsets and the viewport bucket. Clicks on non-interactive elements (needed
 * for dead-click detection and click maps) are captured here as `$autocapture` with
 * `$el_interactive=false`, without element text. Moves are opt-in (`heatmaps.moves`).
 * `heatmaps.attention` adds batched visible-time (`$attention`). Scroll depth lives in `$pageleave` (`$scroll_depth` %, `$scroll_depth_px`).
 */
export const heatmaps: Module = (host) => {
  let enabled = false; // until remote config says otherwise-not-off
  void host.loadConfig().then((r) => (enabled = r?.heatmaps !== false));
  const ac = host.config.autocapture;
  const deny = typeof ac === "object" ? ac.denySelectors : undefined;

  host.clickExtras.push((ev, el) => (enabled ? heatmapProps(ev, el) : {}));

  const onClick = (ev: MouseEvent): void => {
    const t = ev.target;
    if (!enabled || !(t instanceof Element) || t.closest(IGNORE)) return;
    if (deny?.length && t.closest(deny.join(","))) return;
    const interactive = !!t.closest(INTERACTIVE);
    if (interactive && host.autocaptureClicks) return; // autocapture owns this one
    if (t instanceof HTMLInputElement && t.type === "password") return;
    const chain = buildChain(t, false);
    host.client.capture("$autocapture", {
      $event_type: "click",
      $elements: chain,
      $elements_chain: chainToString(chain),
      ...clickProps(host, ev, t, interactive),
    });
  };
  document.addEventListener("click", onClick, true);

  const hm = host.config.heatmaps;
  const stopMoves = hm?.moves ? trackMoves(host, hm.moveIntervalMs ?? 250) : undefined;
  const stopAttention = hm?.attention ? trackAttention(host) : undefined;
  return () => {
    document.removeEventListener("click", onClick, true);
    stopMoves?.();
    stopAttention?.();
  };
};

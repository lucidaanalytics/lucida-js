import type { AutocaptureConfig, Host } from "../types.js";

const MILESTONES = [25, 50, 75] as const;
const TITLE = "data-lc-media-title";

interface PlayState {
  src: string;
  played: boolean;
  reached: Set<number>;
  done: boolean;
}

/** Media URL without query or fragment (signed URLs and tokens stay out of analytics). */
export function mediaSrc(el: HTMLMediaElement): string {
  const raw = el.currentSrc || el.src;
  if (!raw || raw.startsWith("blob:") || raw.startsWith("data:")) return "";
  try {
    const u = new URL(raw, location.href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

const title = (el: HTMLMediaElement): string =>
  (el.getAttribute(TITLE) ?? el.getAttribute("title") ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 200);

/**
 * Video and audio engagement: `$media_play` on the first play of a playthrough, `$media_progress` once at
 * 25, 50 and 75 percent, `$media_complete` when it ends; a new source or a replay after the end starts a new
 * playthrough. Only the element's source URL (no query), duration, kind and an optional
 * `data-lc-media-title` / `title` / `aria-label` are read. `autocapture.media: false` turns it off.
 * Media in cross-origin iframes (embedded players) is not visible to the page and is not tracked.
 */
export function startMediaCapture(host: Host, cfg: AutocaptureConfig, enabled: () => boolean): () => void {
  if (cfg.media === false) return () => {};
  const state = new WeakMap<HTMLMediaElement, PlayState>();
  const props = (el: HTMLMediaElement): Record<string, unknown> => {
    const p: Record<string, unknown> = { $media_type: el instanceof HTMLVideoElement ? "video" : "audio", $media_src: mediaSrc(el) };
    const t = title(el);
    if (t) p.$media_title = t;
    if (Number.isFinite(el.duration)) p.$media_duration = Math.round(el.duration);
    return p;
  };
  const of = (el: HTMLMediaElement): PlayState | null => {
    const src = mediaSrc(el);
    if (!src) return null;
    let s = state.get(el);
    if (!s || s.src !== src) state.set(el, (s = { src, played: false, reached: new Set(), done: false }));
    return s;
  };
  const on = (ev: Event): void => {
    const el = ev.target;
    if (!(el instanceof HTMLMediaElement) || !enabled()) return;
    const s = of(el);
    if (!s) return;
    if (ev.type === "play") {
      if (s.done) Object.assign(s, { played: false, reached: new Set(), done: false });
      if (s.played) return;
      s.played = true;
      host.client.capture("$media_play", props(el));
    } else if (ev.type === "timeupdate") {
      if (!s.played || s.done || !Number.isFinite(el.duration) || el.duration <= 0) return;
      const pct = (el.currentTime / el.duration) * 100;
      for (const m of MILESTONES) {
        if (pct >= m && !s.reached.has(m)) {
          s.reached.add(m);
          host.client.capture("$media_progress", { ...props(el), $media_progress: m });
        }
      }
    } else if (ev.type === "ended" && s.played && !s.done) {
      s.done = true;
      host.client.capture("$media_complete", props(el));
    }
  };
  // Media events do not bubble; a capturing listener on the document sees every element.
  const types = ["play", "timeupdate", "ended"];
  types.forEach((t) => document.addEventListener(t, on, true));
  return () => types.forEach((t) => document.removeEventListener(t, on, true));
}

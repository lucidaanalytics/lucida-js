import type { Host } from "../types.js";
import type { ReplayTrigger } from "./config.js";

const RAGE_CLICKS = 3;
const RAGE_MS = 1000;
const RAGE_PX = 30;

/**
 * Watches for the condition that starts real recording (the ring is flushed by `fire`). The
 * frustration check is only a trigger heuristic; the rage/dead click events themselves are
 * derived server-side (lc-signals). `checkUrl` is called by the recorder on every URL change.
 */
export function watchTrigger(host: Host, t: ReplayTrigger, fire: () => void): { checkUrl(url: string): void; stop(): void } {
  const stops: Array<() => void> = [];
  let on_url: RegExp | undefined;
  switch (t.mode) {
    case "on_event":
      host.onCapture((e) => t.events.includes(e.event) && fire());
      break;
    case "on_flag": {
      const off = host.flags?.onChange((f) => f[t.flag] && fire());
      if (off) stops.push(off);
      break;
    }
    case "on_url":
      try {
        on_url = new RegExp(t.pattern);
      } catch {
        host.log("bad on_url pattern", t.pattern);
      }
      break;
    case "on_frustration": {
      const clicks: Array<{ t: number; x: number; y: number }> = [];
      const h = (ev: MouseEvent): void => {
        const now = Date.now();
        clicks.push({ t: now, x: ev.clientX, y: ev.clientY });
        while (clicks.length && now - (clicks[0] as { t: number }).t > RAGE_MS) clicks.shift();
        const near = clicks.filter((c) => Math.hypot(c.x - ev.clientX, c.y - ev.clientY) <= RAGE_PX);
        if (near.length >= RAGE_CLICKS) fire();
      };
      document.addEventListener("click", h, true);
      stops.push(() => document.removeEventListener("click", h, true));
      break;
    }
    default:
  }
  return {
    checkUrl: (url) => on_url?.test(url) && fire(),
    stop: () => stops.forEach((s) => s()),
  };
}

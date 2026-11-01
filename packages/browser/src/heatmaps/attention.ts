/** Page geometry and clock, injected so the tracker is deterministic in tests. */
export interface AttentionEnv {
  now(): number;
  scrollY(): number;
  viewportH(): number;
  pageH(): number;
  visible(): boolean;
}

export interface AttentionBatch {
  /** `[band 0..9, ms]`: band b covers b*10..b*10+10 percent of page height. */
  bands: Array<[number, number]>;
  /** `[selector, ms]`: time with at least half of the element in view. */
  elements: Array<[string, number]>;
}

const MIN_MS = 100;

/**
 * Visible-time accumulator (LC-EXP-20). `tick()` credits the elapsed time since the previous tick to
 * every scroll band the viewport overlaps (only while the tab is visible); `enter/leave` bracket an
 * element's time in view (fed by an IntersectionObserver). `drain()` returns and resets the totals.
 */
export function attentionTracker(env: AttentionEnv) {
  const bands = new Array<number>(10).fill(0);
  const els = new Map<string, number>();
  const open = new Map<string, number>();
  let last = env.now();

  const credit = (sel: string, ms: number): void => void els.set(sel, (els.get(sel) ?? 0) + ms);
  return {
    tick(): void {
      const now = env.now();
      const dt = now - last;
      last = now;
      if (dt <= 0 || !env.visible()) return;
      const h = Math.max(env.pageH(), 1);
      const lo = Math.max(0, env.scrollY());
      const hi = Math.min(h, lo + env.viewportH());
      for (let b = 0; b < 10; b++) {
        const from = (b * h) / 10;
        const to = ((b + 1) * h) / 10;
        if (lo < to && hi > from) bands[b] = (bands[b] ?? 0) + dt;
      }
    },
    enter(sel: string): void {
      if (!open.has(sel)) open.set(sel, env.now());
    },
    leave(sel: string): void {
      const t = open.get(sel);
      if (t === undefined) return;
      open.delete(sel);
      if (env.visible()) credit(sel, env.now() - t);
    },
    drain(): AttentionBatch {
      const now = env.now();
      for (const [sel, t] of open) {
        if (env.visible()) credit(sel, now - t);
        open.set(sel, now); // still in view: keep timing from here
      }
      const out: AttentionBatch = {
        bands: bands.flatMap((ms, b): Array<[number, number]> => (ms >= MIN_MS ? [[b, Math.round(ms)]] : [])),
        elements: [...els].filter(([, ms]) => ms >= MIN_MS).map(([s, ms]): [string, number] => [s, Math.round(ms)]),
      };
      bands.fill(0);
      els.clear();
      return out;
    },
  };
}

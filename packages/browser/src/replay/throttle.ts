import { rateLimiter } from "../ratelimit.js";
import type { DomEvent } from "./visit.js";

export interface MutationThrottle {
  /** Attribute changes one element may make in a burst (default 100). */
  burst?: number;
  /** Sustained attribute changes per element per second after the burst (default 10). */
  perSecond?: number;
}

const MAX_TRACKED = 10_000;

/**
 * Per-element attribute-mutation guard (LC-EXP-65): an element that rewrites its attributes in a loop
 * (animations, timers) would flood the recording. Each element id gets a token bucket; changes beyond it
 * are dropped from the mutation, and a mutation left empty is dropped whole. Adds, removes and text stay.
 */
export function mutationThrottle(o: MutationThrottle, now: () => number = Date.now) {
  const buckets = new Map<number, () => boolean>();
  let dropped = 0;
  return {
    /** False when the event should be discarded. Mutates the event's attribute list in place. */
    allow(e: DomEvent): boolean {
      const d = e.data;
      if (e.type !== 3 || d?.source !== 0 || !d.attributes?.length) return true;
      if (buckets.size > MAX_TRACKED) buckets.clear(); // bounded memory on pages with huge, churning DOMs
      d.attributes = d.attributes.filter((a) => {
        let take = buckets.get(a.id);
        if (!take) buckets.set(a.id, (take = rateLimiter({ burst: o.burst ?? 100, eventsPerSecond: o.perSecond ?? 10 }, now)));
        if (take()) return true;
        dropped++;
        return false;
      });
      return !!(d.attributes.length || d.adds?.length || d.removes?.length || d.texts?.length);
    },
    get dropped(): number {
      return dropped;
    },
  };
}

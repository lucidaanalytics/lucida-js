// rrweb IncrementalSource values a person causes: mouse move/interaction, scroll, viewport resize, input, touch, media, drag.
const USER_SOURCES = new Set([1, 2, 3, 4, 5, 6, 7, 12]);

export interface IdleEvent {
  type: number;
  timestamp?: number;
  data?: { source?: number };
}

export interface IdleGate {
  /** Whether the event is kept; `resumed` is true when this interaction ends an idle stretch that dropped events (the player needs a fresh snapshot). */
  check(e: IdleEvent): { keep: boolean; resumed: boolean };
}

/**
 * A tab left open with a ticking clock or live feed keeps emitting DOM mutations forever. Once no person-driven event
 * has been seen for `thresholdMs`, everything is dropped until the next interaction, so the recording neither
 * balloons nor stays "active". `thresholdMs <= 0` turns the gate off.
 */
export function idleGate(thresholdMs: number): IdleGate {
  let last: number | undefined;
  let idle = false;
  let dropped = 0;
  return {
    check(e) {
      if (thresholdMs <= 0) return { keep: true, resumed: false };
      const ts = e.timestamp ?? Date.now();
      last ??= ts;
      if (e.type === 3 && USER_SOURCES.has(e.data?.source ?? -1)) {
        last = ts;
        const resumed = idle && dropped > 0;
        idle = false;
        dropped = 0;
        return { keep: true, resumed };
      }
      if (!idle && ts - last > thresholdMs) idle = true;
      if (!idle) return { keep: true, resumed: false };
      dropped++;
      return { keep: false, resumed: false };
    },
  };
}

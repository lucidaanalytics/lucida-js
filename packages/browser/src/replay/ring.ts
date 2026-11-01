/**
 * In-memory buffer for trigger modes. rrweb takes a full-snapshot checkout every bufferMs/2, and
 * the ring keeps the last two segments (each starting at a snapshot), so a flush always begins with
 * a playable snapshot and covers between bufferMs/2 and bufferMs of history.
 */
export function createRing<E>() {
  let segments: E[][] = [[]];
  return {
    /** A checkout event starts a new segment; only the previous and the new one survive. */
    push(event: E, isCheckout: boolean): void {
      if (isCheckout) segments = [segments[segments.length - 1] as E[], []];
      (segments[segments.length - 1] as E[]).push(event);
    },
    /** Everything buffered, oldest first; empties the ring. */
    drain(): E[] {
      const all = segments.flat();
      segments = [[]];
      return all;
    },
    get size(): number {
      return segments.reduce((n, s) => n + s.length, 0);
    },
  };
}

export type Ring<E> = ReturnType<typeof createRing<E>>;

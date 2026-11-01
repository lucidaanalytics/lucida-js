/** Engagement arbiter: one guide on screen at a time. `claim()` returns a release or null. */
let busy = false;

export function claim(): (() => void) | null {
  if (busy) return null;
  busy = true;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busy = false;
  };
}

/** Test helper. */
export function resetArbiter(): void {
  busy = false;
}

/**
 * Emits `page_height` custom events ({height}) so the server can compute scroll depth against the
 * real document height (closes G16): on load, resize, and throttled after DOM mutations. Only
 * emits when the height changed. `reset()` after a new full snapshot (the walker forgets it).
 */
export function pageHeightEmitter(emit: (height: number) => void, throttleMs = 1000) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = (): void => {
    timer = undefined;
    const h = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
    if (h > 0 && h !== last) {
      last = h;
      emit(h);
    }
  };
  const schedule = (): void => {
    timer ??= setTimeout(check, throttleMs);
  };
  window.addEventListener("load", schedule);
  window.addEventListener("resize", schedule);
  return {
    schedule,
    reset(): void {
      last = 0;
      if (timer !== undefined) clearTimeout(timer);
      check();
    },
    stop(): void {
      window.removeEventListener("load", schedule);
      window.removeEventListener("resize", schedule);
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

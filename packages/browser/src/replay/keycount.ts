/**
 * Counts real key presses for the replay's `keypress_count` (rrweb records one input event per
 * field change, not per key). Emits `keys` custom events ({n}) at most once per `everyMs`.
 * Only a number leaves the page: no key, no field, no per-key timing. Presses in password fields
 * and in masked/blocked/ignored elements are not counted, so a count never reveals how long a
 * hidden value is. Auto-repeat and lone modifier keys are skipped.
 */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);

export function keyCounter(emit: (n: number) => boolean, skipSelector: () => string, everyMs = 1000) {
  let n = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    timer = undefined;
    if (n > 0 && emit(n)) n = 0; // not recording right now: keep the count for the next flush
  };
  const skipped = (t: EventTarget | null): boolean => {
    if (!(t instanceof Element)) return false;
    if (t instanceof HTMLInputElement && t.type === "password") return true;
    const sel = skipSelector();
    try {
      return !!sel && !!t.closest(sel);
    } catch {
      return false; // an invalid customer selector must not stop the page's typing
    }
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || MODIFIERS.has(e.key) || skipped(e.target)) return;
    n++;
    timer ??= setTimeout(flush, everyMs);
  };
  document.addEventListener("keydown", onKey, { capture: true, passive: true });
  return {
    flush,
    stop(): void {
      document.removeEventListener("keydown", onKey, { capture: true });
      if (timer !== undefined) clearTimeout(timer);
      flush();
    },
  };
}

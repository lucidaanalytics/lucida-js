import { safeString } from "./redact.js";

const LEVELS = ["log", "info", "warn", "error", "debug"] as const;
type Level = (typeof LEVELS)[number];
type Fn = (...a: unknown[]) => void;
const MAX_ENTRIES = 1000; // per recorder: a console loop must not flood the recording
const MAX_ARGS = 10;

export interface ConsoleEntry {
  level: Level;
  args: string[];
}

/**
 * Mirrors console output (and uncaught errors / unhandled rejections, as error entries) into the recording
 * only; nothing becomes an analytics event. `masked()` is true under text masking: the message text is then
 * withheld and the level kept. Returns the undo function.
 */
export function captureConsole(emit: (e: ConsoleEntry) => void, masked: () => boolean): () => void {
  let n = 0;
  let busy = false; // a console call made while serializing must not recurse
  const push = (level: Level, args: unknown[]): void => {
    if (busy || n >= MAX_ENTRIES) return;
    busy = true;
    try {
      n++;
      emit({ level, args: masked() ? ["[masked]"] : args.slice(0, MAX_ARGS).map((a) => safeString(a)) });
    } catch {
      /* never break the page's console */
    } finally {
      busy = false;
    }
  };
  const saved = {} as Record<Level, Fn>;
  const mine = {} as Record<Level, Fn>;
  for (const l of LEVELS) {
    const orig = console[l] as Fn;
    saved[l] = orig;
    mine[l] = function (this: unknown, ...a: unknown[]): void {
      orig.apply(this, a);
      push(l, a);
    };
    console[l] = mine[l];
  }
  const onError = (e: ErrorEvent): void => push("error", [e.error ?? e.message]);
  const onRejection = (e: PromiseRejectionEvent): void => push("error", ["Unhandled rejection:", e.reason]);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    for (const l of LEVELS) if (console[l] === mine[l]) console[l] = saved[l]; // only if still ours
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

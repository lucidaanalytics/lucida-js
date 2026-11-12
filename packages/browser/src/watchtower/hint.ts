import type { Host } from "../types.js";

const SEEN = "__lucidaWatchtowerHint";

/**
 * One console hint per page when Watchtower's SDK is present (`globalThis.watchtower`, or its `watchtower:ready` event) while
 * Lucida's `exposeGlobal` is off: Watchtower finds Lucida only through `globalThis.lucida` / `lucida:ready`, so the link is not made.
 */
export function exposeGlobalHint(host: Host): () => void {
  if (host.config.exposeGlobal || host.config.disabled) return () => {};
  const g = globalThis as unknown as Record<string, unknown>;
  const say = (): void => {
    if (g[SEEN]) return;
    g[SEEN] = true;
    console.info(
      "[lucida] Watchtower is on this page but Lucida's `exposeGlobal` is off, so Watchtower cannot find Lucida to link sessions. Set `exposeGlobal: true` in the Lucida init options.",
    );
  };
  if (g.watchtower) {
    say();
    return () => {};
  }
  window.addEventListener("watchtower:ready", say, { once: true });
  return () => window.removeEventListener("watchtower:ready", say);
}

import { DEFAULT_HOST, LIB_VERSION } from "./client.js";
import { isExtensionPage, loadModules } from "./delivery.js";
import { init } from "./index.js";
import type { Importer } from "./delivery.js";
import type { BrowserConfig, Client, Module } from "./types.js";

/** A queued command: ["init", apiKey, config] or [method, ...args] for a Client method. */
export type Command = [string, ...unknown[]];

type Queue = Command[] & { push: (...c: Command[]) => number };

/** Origin the classic script was loaded from (read while it runs: `currentScript` is null afterwards). */
const scriptOrigin = ((): string | undefined => {
  try {
    const src = typeof document === "undefined" ? undefined : (document.currentScript as HTMLScriptElement | null)?.src;
    return src ? new URL(src).origin : undefined;
  } catch {
    return undefined;
  }
})();

/**
 * The `modules` named in the init config, loaded from `<assetHost>/static/v<this version>/`. Extension mode never
 * loads remote code (MV3 forbids it): bundle the modules and use `createClient` instead.
 */
function lazyModules(cfg: BrowserConfig, importer?: Importer, fetchImpl?: typeof fetch): Promise<Module[]> {
  if (!cfg.modules?.length) return Promise.resolve([]);
  if (cfg.extension ?? isExtensionPage()) {
    console.warn("[lucida] extension mode: `modules` are not loaded remotely; bundle them with createClient");
    return Promise.resolve([]);
  }
  const assetHost = cfg.assetHost ?? scriptOrigin ?? cfg.apiHost ?? DEFAULT_HOST; // the loader's own host serves its modules
  return loadModules(cfg.modules, { assetHost, version: LIB_VERSION }, (...a) => console.warn("[lucida]", ...a), importer, fetchImpl);
}

/**
 * Classic-script loader (dist/lucida.js) for tag managers: drains `window.lucidaQueue`, then
 * replaces its `push` so later commands run immediately. Commands before `init` wait for it (and for the
 * `modules` it loads).
 */
export function drain(w: { lucidaQueue?: Command[]; lucida?: Client }, importer?: Importer, fetchImpl?: typeof fetch): Promise<void> {
  const q = (w.lucidaQueue ?? []) as Queue;
  let pending: Command[] = [];
  let starting: Promise<void> = Promise.resolve();
  let initCalled = false;
  const run = (c: Command): void => {
    const [name, ...args] = c;
    if (name === "init") {
      if (w.lucida || initCalled) return;
      initCalled = true;
      const cfg = (args[1] ?? {}) as BrowserConfig;
      const boot = (mods: Module[]): void => {
        // A Lucida-hosted loader (no assetHost) sits on the app host, so replay links point there, not at the capture host.
        const ui = !cfg.uiHost && !cfg.assetHost && scriptOrigin ? { uiHost: scriptOrigin } : {};
        w.lucida = init(String(args[0]), { ...ui, ...cfg }, mods);
        const later = pending;
        pending = [];
        later.forEach(run);
      };
      if (cfg.modules?.length) starting = lazyModules(cfg, importer, fetchImpl).then(boot);
      else boot([]); // no remote modules: start synchronously, as before
      return;
    }
    if (!w.lucida) {
      pending.push(c);
      return;
    }
    const fn = (w.lucida as unknown as Record<string, unknown>)[name];
    if (typeof fn === "function") (fn as (...a: unknown[]) => unknown).apply(w.lucida, args);
  };
  const queued = q.splice(0);
  q.push = (...cs: Command[]) => {
    cs.forEach(run);
    return q.length;
  };
  w.lucidaQueue = q;
  queued.forEach(run);
  return starting;
}

if (typeof window !== "undefined") void drain(window as unknown as { lucidaQueue?: Command[]; lucida?: Client });

import { Lucida } from "@lucida-analytics/node";
import type { LucidaOptions } from "@lucida-analytics/node";
import type { Flags, LucidaNextOptions } from "./shared.js";

export interface ServerOptions extends LucidaNextOptions {
  /** Secret key (lc_sk_...): enables local flag evaluation with streamed definitions. Server-only, never NEXT_PUBLIC. */
  secretKey: string;
  node?: LucidaOptions;
}

// One client per process: Next re-evaluates modules on every dev reload, which would leak pollers and streams.
const KEY = Symbol.for("lucida.next.server");
type G = { [KEY]?: Map<string, Lucida> };

/** The shared node SDK client (local evaluation, SSE definitions stream, event queue). */
export function lucidaServer(o: ServerOptions): Lucida {
  const g = globalThis as G;
  const cache = (g[KEY] ??= new Map());
  let c = cache.get(o.apiKey);
  if (!c) {
    c = new Lucida(o.apiKey, { secretKey: o.secretKey, ...(o.host ? { host: o.host } : {}), ...o.node });
    cache.set(o.apiKey, c);
  }
  return c;
}

/**
 * `evaluate` for `lucidaMiddleware` / `getBootstrap`: decides flags locally in the Node runtime (not the edge:
 * the node SDK needs node:zlib). Waits for the first definitions fetch so a cold start does not render flagless.
 */
export function nodeEvaluator(o: ServerOptions): (distinctId: string) => Promise<Flags> {
  const c = lucidaServer(o);
  return async (id) => {
    await c.ready;
    return (await c.getAllFlags(id)) as Flags;
  };
}

/** Server-side capture/flag access for route handlers and server actions. */
export { Lucida } from "@lucida-analytics/node";

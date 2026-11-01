import { bootstrapScript, createEdgeClient, requestBootstrap } from "@lucida/edge";
import type { BootstrapOptions, EdgeClient, EdgeOptions, RequestBootstrap } from "@lucida/edge";

export { bootstrapScript };
export type { RequestBootstrap };

/** What the middleware puts on `Astro.locals.lucida`. */
export interface LucidaLocals extends RequestBootstrap {
  client: EdgeClient;
}

/** The slice of Astro's APIContext the middleware touches. */
export interface AstroContextLike {
  request: Request;
  locals: Record<string, unknown>;
}

/**
 * Astro middleware (`src/middleware.ts`): resolves the visitor and their flags once per request into
 * `Astro.locals.lucida`, and persists the anonymous id cookie when consent allows. Render the flags for first paint with
 * `<script is:inline set:html={bootstrapScript(Astro.locals.lucida)} />` then `init(key, { bootstrap: window.__LUCIDA_BOOTSTRAP__ })`.
 */
export function lucidaMiddleware(opts: EdgeOptions | { client: EdgeClient }, flagOpts: BootstrapOptions = {}) {
  const client = "client" in opts ? opts.client : createEdgeClient(opts);
  return async (ctx: AstroContextLike, next: () => Promise<Response>): Promise<Response> => {
    const b = await requestBootstrap(client, ctx.request.headers.get("cookie"), flagOpts);
    ctx.locals.lucida = { ...b, client } satisfies LucidaLocals;
    const res = await next();
    if (b.setCookie) res.headers.append("Set-Cookie", b.setCookie);
    return res;
  };
}

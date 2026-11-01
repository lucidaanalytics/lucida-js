import { requestBootstrap } from "@lucida/edge";
import type { BootstrapOptions, EdgeClient } from "@lucida/edge";
import { requestContext } from "@lucida/sdk-core";
import type { FlagValue, RequestContext } from "@lucida/sdk-core";

/** What `lucidaHandle` puts on `event.locals.lucida`. Add it to `App.Locals` in `app.d.ts`. */
export interface LucidaLocals {
  distinctId: string;
  flags: Record<string, FlagValue>;
  /** Tracing ids the browser sent (client-controlled: stitching only, never auth) and request props for server events. */
  context: RequestContext;
}

/** The slice of SvelteKit's `RequestEvent` the handle uses (structural: no `@sveltejs/kit` import needed). */
export interface RequestEventLike {
  request: Request;
  // No index signature: SvelteKit's `App.Locals` is an interface, which an index signature would reject.
  locals: { lucida?: LucidaLocals };
  getClientAddress?: () => string;
}

export interface LucidaHandleOptions extends BootstrapOptions {
  /** First X-Forwarded-For hop becomes `$ip` (only behind a proxy you control). Default false. */
  trustProxy?: boolean;
}

/**
 * `hooks.server.ts` handle: resolves the visitor once per request, evaluates flags, exposes everything on
 * `event.locals.lucida` and stores a new anonymous id when consent allows (Set-Cookie on the response).
 *
 * ```ts
 * // hooks.server.ts
 * import { createEdgeClient } from "@lucida/edge";
 * import { lucidaHandle } from "@lucida/svelte/server";
 * export const handle = lucidaHandle(createEdgeClient({ apiKey: "lc_pk_...", host: "https://app.lucida.dev" }));
 * // +layout.server.ts: return { lucida: { distinctId: locals.lucida.distinctId, flags: locals.lucida.flags } }
 * // +layout.svelte:  createLucida({ apiKey, options: { bootstrap: { distinctId } }, bootstrapFlags: flags })
 * ```
 * Compose with other handles via SvelteKit's `sequence()`. SSR never loads the browser SDK, and session replay only
 * starts in the browser after hydration.
 */
export function lucidaHandle(client: EdgeClient, o: LucidaHandleOptions = {}) {
  // Generic over the event so SvelteKit's own `Handle` type (its `RequestEvent` and `resolve`) fits without a cast.
  const { trustProxy, ...bootstrapOptions } = o;
  return async <E extends RequestEventLike>({ event, resolve }: { event: E; resolve: (e: E, ...rest: never[]) => Promise<Response> | Response }): Promise<Response> => {
    const { setCookie, distinctId, flags } = await requestBootstrap(client, event.request.headers.get("cookie"), bootstrapOptions);
    const req = event.request;
    let remoteAddr: string | undefined;
    try {
      remoteAddr = event.getClientAddress?.();
    } catch {
      /* adapters without a peer address (prerender): $ip stays unset */
    }
    const seen = requestContext({ url: req.url, method: req.method, header: (n) => req.headers.get(n), remoteAddr }, { trustProxy: !!trustProxy });
    event.locals.lucida = { distinctId, flags, context: { ...seen, distinctId: seen.distinctId ?? distinctId } };
    const res = await resolve(event);
    if (!setCookie) return res;
    // Responses from resolve() can be immutable (redirects, fetch results): copy before adding a header.
    const out = new Response(res.body, res);
    out.headers.append("Set-Cookie", setCookie);
    return out;
  };
}

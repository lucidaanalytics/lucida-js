import { requestBootstrap } from "@lucida-analytics/edge";
import type { BootstrapOptions, EdgeClient, RequestBootstrap } from "@lucida-analytics/edge";
import { requestContext } from "@lucida-analytics/sdk-core";
import type { RequestContext } from "@lucida-analytics/sdk-core";

/**
 * Request middleware context: returns `{ lucida }` to hand to `next({ context })` so server functions and routes can read
 * the visitor and request props.
 *
 * ```ts
 * export const lucidaMiddleware = createMiddleware().server(({ next, request }) => next({ context: lucidaServerContext(request) }));
 * // in a server function: context.lucida.distinctId, context.lucida.props
 * ```
 * The distinct and session ids come from `X-Lucida-*` request headers (set by the browser SDK's `tracingHeaders`);
 * they are client-controlled, so use them to stitch analytics, never for auth.
 */
export function lucidaServerContext(request: Request, o: { trustProxy?: boolean; remoteAddr?: string } = {}): { lucida: RequestContext } {
  return {
    lucida: requestContext(
      { url: request.url, method: request.method, header: (n) => request.headers.get(n), remoteAddr: o.remoteAddr },
      { trustProxy: !!o.trustProxy },
    ),
  };
}

/**
 * Visitor bootstrap for SSR: pass `bootstrap` to `LucidaProvider` options (`bootstrap: { distinctId, flags }`) and
 * append `headers` to the response so a new anonymous id is stored (consent permitting).
 */
export async function lucidaBootstrap(
  client: EdgeClient,
  request: Request,
  o?: BootstrapOptions,
): Promise<{ bootstrap: Pick<RequestBootstrap, "distinctId" | "flags">; headers: Headers }> {
  const { setCookie, ...bootstrap } = await requestBootstrap(client, request.headers.get("cookie"), o);
  const headers = new Headers();
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return { bootstrap, headers };
}

/**
 * Server handler for `createMiddleware().server(...)`: gives every server function and route
 * `context.lucida` (visitor ids from the `X-Lucida-*` headers and request props) with no extra code.
 *
 * ```ts
 * export const lucidaMw = createMiddleware().server(lucidaMiddleware({ trustProxy: true }));
 * // registered in start.ts: requestMiddleware: [lucidaMw]
 * ```
 */
export function lucidaMiddleware(o: { trustProxy?: boolean } = {}) {
  return <R>({ next, request }: { next: (opts: { context: { lucida: RequestContext } }) => R; request: Request }): R =>
    next({ context: lucidaServerContext(request, o) });
}

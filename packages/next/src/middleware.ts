import { requestContext } from "@lucida-analytics/sdk-core";
import type { RequestContext } from "@lucida-analytics/sdk-core";
import { COOKIE_ID, HEADER_CTX, HEADER_FLAGS, HEADER_ID, mayStoreId, newDistinctId, resolveFlags } from "./shared.js";
import type { Flags, LucidaNextOptions } from "./shared.js";

/** The slice of NextRequest the middleware reads (structural, so `next` is not needed to build or test this). */
export interface RequestLike {
  headers: Headers;
  url?: string;
  method?: string;
  cookies: { get(name: string): { value: string } | undefined };
}
/** The slice of NextResponse it writes. */
export interface ResponseLike {
  cookies: { set(name: string, value: string, opts?: Record<string, unknown>): unknown };
}

export interface LucidaMiddlewareOptions extends LucidaNextOptions {
  /**
   * Your own consent read (e.g. a Cookie Munch cookie). `true` allows the distinct-id cookie, `false` forbids it,
   * `undefined` falls back to the `lc_consent` cookie the browser SDK's CMP bridges write.
   */
  consent?: (req: RequestLike) => boolean | undefined;
}

export interface LucidaMiddleware {
  distinctId: string;
  flags: Flags;
  /** Distinct id (tracing header, else the cookie id), session id and request props for server-side events. */
  context: RequestContext;
  /** Pass to `NextResponse.next({ request: { headers } })` so server components see the bootstrap on this very request. */
  requestHeaders: Headers;
  /** Writes the distinct-id cookie (consent permitting) and returns the response. */
  apply<R extends ResponseLike>(res: R): R;
}

const YEAR_S = 365 * 24 * 3600;

/**
 * Edge-safe middleware helper that avoids flag flicker: resolves the visitor's id and flags once per request,
 * forwards them as request headers, and persists the anonymous id in a first-party cookie.
 *
 * ```ts
 * export async function middleware(req: NextRequest) {
 *   const lc = await lucidaMiddleware(req, { apiKey: process.env.NEXT_PUBLIC_LUCIDA_KEY! });
 *   return lc.apply(NextResponse.next({ request: { headers: lc.requestHeaders } }));
 * }
 * ```
 * With a CMP bridge in the browser SDK, `lc_consent` is written on each decision; pass `consent` to read your CMP yourself.
 * Without consent no cookie is written and the id lasts for this request only; the browser SDK then
 * keeps its own consent-gated identity.
 */
export async function lucidaMiddleware(req: RequestLike, o: LucidaMiddlewareOptions): Promise<LucidaMiddleware> {
  const cookie = (n: string) => req.cookies.get(n)?.value;
  const existing = cookie(COOKIE_ID);
  const store = o.consent?.(req) ?? mayStoreId(o, cookie);
  const distinctId = existing ?? newDistinctId();
  const flags = await resolveFlags(o, distinctId);
  const requestHeaders = new Headers(req.headers);
  // A client must not be able to pick its own bootstrap: always overwrite whatever arrived.
  requestHeaders.set(HEADER_ID, distinctId);
  requestHeaders.set(HEADER_FLAGS, JSON.stringify(flags));
  const seen = requestContext({ url: req.url, method: req.method, header: (n) => req.headers.get(n) }, { trustProxy: !!o.trustProxy });
  const context: RequestContext = { ...seen, distinctId: seen.distinctId ?? distinctId };
  requestHeaders.set(HEADER_CTX, JSON.stringify(context));
  return {
    distinctId,
    flags,
    context,
    requestHeaders,
    apply(res) {
      if (store && !existing) res.cookies.set(COOKIE_ID, distinctId, { path: "/", maxAge: YEAR_S, sameSite: "lax", httpOnly: false });
      return res;
    },
  };
}

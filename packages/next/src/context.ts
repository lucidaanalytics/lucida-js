import { requestContext } from "@lucida-analytics/sdk-core";
import type { RequestContext } from "@lucida-analytics/sdk-core";
import type { HeadersLike } from "./bootstrap.js";
import { HEADER_CTX } from "./shared.js";
import type { LucidaNextOptions } from "./shared.js";

function parse(raw: string | null): RequestContext | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as RequestContext;
    return v && typeof v === "object" && v.props && typeof v.props === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Server-side event context for a request: the distinct id and session id the browser sent in
 * `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` (client-controlled: never use for auth) plus `$current_url`,
 * `$request_method`, `$request_path`, `$user_agent`, `$ip`. With `middleware: true` it reads what `lucidaMiddleware`
 * forwarded; otherwise it derives them from the headers (pass `req` for url and method).
 *
 * ```ts
 * const ctx = getRequestContext(await headers(), opts);
 * lucida.capture({ distinctId: ctx.distinctId ?? "anon", event: "order", properties: { ...ctx.props, total } });
 * ```
 */
export function getRequestContext(headers: HeadersLike, o: Pick<LucidaNextOptions, "middleware" | "trustProxy">, req: { url?: string; method?: string } = {}): RequestContext {
  const forwarded = o.middleware ? parse(headers.get(HEADER_CTX)) : undefined;
  if (forwarded) return forwarded;
  return requestContext({ url: req.url, method: req.method, header: (n) => headers.get(n) }, { trustProxy: !!o.trustProxy });
}

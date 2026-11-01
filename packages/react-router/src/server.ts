import { requestContext } from "@lucida/sdk-core";
import type { RequestContext } from "@lucida/sdk-core";

/**
 * Framework mode (loaders/actions, any runtime): the visitor and request context for server-side events.
 * Reads `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` (client-controlled: stitching only, never auth) and builds
 * `$current_url`, `$request_method`, `$request_path`, `$user_agent`, `$ip`. Pass the runtime's peer address as
 * `remoteAddr` (e.g. from your adapter), or set `trustProxy` to use the first X-Forwarded-For hop.
 *
 * ```ts
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   const ctx = lucidaRequestContext(request, { trustProxy: true });
 *   lucida.capture({ distinctId: ctx.distinctId ?? "anonymous", event: "loader", properties: ctx.props });
 * }
 * ```
 */
export function lucidaRequestContext(request: Request, o: { trustProxy?: boolean; remoteAddr?: string } = {}): RequestContext {
  return requestContext(
    { url: request.url, method: request.method, header: (n) => request.headers.get(n), remoteAddr: o.remoteAddr },
    { trustProxy: !!o.trustProxy },
  );
}

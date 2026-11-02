import { requestContext } from "@lucida-analytics/sdk-core";
import type { Props, RequestContext } from "@lucida-analytics/sdk-core";

export type { RequestContext } from "@lucida-analytics/sdk-core";

/** The slice of `@lucida-analytics/node`'s client the middleware calls. */
export interface CaptureTarget {
  capture(i: { distinctId: string; event: string; properties?: Props }): void;
}

/** The slice of a Hono `Context` the middleware uses (structural, so `hono` is not a dependency). */
export interface HonoContextLike {
  req: { raw: Request };
  set(key: "lucida", value: LucidaRequest): void;
}

/** What `c.get("lucida")` returns inside handlers. */
export interface LucidaRequest {
  /** Distinct id the browser sent (client-controlled: never use for auth), if any. */
  distinctId: string | undefined;
  sessionId: string | undefined;
  /** `$current_url`, `$request_method`, `$request_path`, `$user_agent`, `$ip` (+ `$session_id`). */
  context: RequestContext;
  /**
   * Capture with the request context merged in; explicit `properties` win. `distinctId` defaults to the browser's id; with
   * neither, the event gets a random id and `$process_person_profile: false` so it creates no person.
   */
  capture(event: string, properties?: Props, distinctId?: string): void;
}

export interface LucidaHonoOptions {
  /** First X-Forwarded-For hop becomes `$ip` (only behind a proxy you control). Default false. */
  trustProxy?: boolean;
  /** Peer address when not behind a proxy, e.g. `(c) => getConnInfo(c).remote.address` from your runtime adapter. */
  remoteAddr?: (c: HonoContextLike) => string | undefined;
}

/**
 * Hono middleware: `app.use(lucida(client))`, then in handlers `c.get("lucida").capture("order_paid", { total })`.
 * Type the variables with `new Hono<{ Variables: { lucida: LucidaRequest } }>()`.
 */
export function lucida(client: CaptureTarget, o: LucidaHonoOptions = {}) {
  return async (c: HonoContextLike, next: () => Promise<void>): Promise<void> => {
    const req = c.req.raw;
    const remoteAddr = o.remoteAddr?.(c);
    const context = requestContext(
      { url: req.url, method: req.method, header: (n) => req.headers.get(n), remoteAddr },
      { trustProxy: !!o.trustProxy },
    );
    c.set("lucida", {
      distinctId: context.distinctId,
      sessionId: context.sessionId,
      context,
      capture(event, properties, distinctId) {
        const id = distinctId ?? context.distinctId;
        client.capture({
          distinctId: id ?? crypto.randomUUID(),
          event,
          properties: { ...context.props, ...(id ? {} : { $process_person_profile: false }), ...properties },
        });
      },
    });
    await next();
  };
}

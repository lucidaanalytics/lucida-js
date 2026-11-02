import { AsyncLocalStorage } from "node:async_hooks";
import { cleanHeader, DISTINCT_ID_HEADER, SESSION_ID_HEADER } from "@lucida-analytics/sdk-core";
import type { Props } from "@lucida-analytics/sdk-core";


/** Ambient identity for events captured inside `withContext`. The object is live: assign `distinctId` after login. */
export interface RequestContext {
  distinctId?: string;
  sessionId?: string;
  properties: Props;
}

const als = new AsyncLocalStorage<RequestContext>();

/** The innermost active context, or undefined. */
export const getContext = (): RequestContext | undefined => als.getStore();

/**
 * Run `fn` with a context. Nested contexts inherit the parent's values unless `fresh: true`; changes made inside a
 * child never leak into the parent. `capture()` merges the context under the event's own values: explicit arguments win.
 */
export function withContext<T>(
  init: { distinctId?: string; sessionId?: string; properties?: Props },
  fn: () => T,
  opts: { fresh?: boolean } = {},
): T {
  const parent = opts.fresh ? undefined : als.getStore();
  const distinctId = init.distinctId ?? parent?.distinctId;
  const sessionId = init.sessionId ?? parent?.sessionId;
  const ctx: RequestContext = {
    ...(distinctId !== undefined ? { distinctId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    properties: { ...parent?.properties, ...init.properties },
  };
  return als.run(ctx, fn);
}

// Header hygiene (cleanHeader) and the header names are shared with the edge/framework wrappers (@lucida-analytics/sdk-core).

export type HeaderBag = Record<string, string | string[] | undefined> | { get(name: string): string | null | undefined };

/** Case-insensitive single header lookup (first value of an array). */
export function headerOf(h: HeaderBag, name: string): string | undefined {
  if (typeof (h as { get?: unknown }).get === "function") return (h as { get(n: string): string | null | undefined }).get(name) ?? undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h as Record<string, string | string[] | undefined>)) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * Read the browser SDK's tracing headers (`X-Lucida-Distinct-Id`, `X-Lucida-Session-Id`).
 * These are client-controlled: use them to join events to a browser session, never for authentication.
 */
export function readTracingHeaders(h: HeaderBag): { distinctId?: string; sessionId?: string } {
  const distinctId = cleanHeader(headerOf(h, DISTINCT_ID_HEADER));
  const sessionId = cleanHeader(headerOf(h, SESSION_ID_HEADER));
  return { ...(distinctId ? { distinctId } : {}), ...(sessionId ? { sessionId } : {}) };
}

export interface RequestInfo {
  headers: HeaderBag;
  method?: string | undefined;
  /** Absolute URL when known. */
  url?: string | undefined;
  path?: string | undefined;
  /** Socket peer address. */
  remoteAddr?: string | undefined;
}

export interface RequestContextOptions {
  /** Skip the context for requests where this returns false. */
  requestFilter?: (req: unknown) => boolean;
  extraProperties?: Props;
  /** Read the browser tracing headers (default true). */
  captureTracingHeaders?: boolean;
  /** Take `$ip` from the first X-Forwarded-For entry (default false: the socket peer). */
  trustProxy?: boolean;
}

/** Context init for one request: tracing-header ids plus `$current_url`, `$request_method`, `$request_path`, `$user_agent`, `$ip`. */
export function requestContextInit(r: RequestInfo, o: RequestContextOptions = {}): { distinctId?: string; sessionId?: string; properties: Props } {
  const fwd = o.trustProxy ? cleanHeader(headerOf(r.headers, "x-forwarded-for")?.split(",")[0]) : undefined;
  const raw: Props = {
    $current_url: r.url,
    $request_method: r.method,
    $request_path: r.path,
    $user_agent: cleanHeader(headerOf(r.headers, "user-agent")),
    $ip: fwd ?? r.remoteAddr,
  };
  const props: Props = {};
  for (const [k, v] of Object.entries(raw)) if (v) props[k] = v;
  return {
    ...(o.captureTracingHeaders === false ? {} : readTracingHeaders(r.headers)),
    properties: { ...props, ...o.extraProperties },
  };
}

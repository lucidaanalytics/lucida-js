import type { Props } from "./ports.js";

/** Tracing headers the browser SDK sends to your own backend (`tracingHeaders`). */
export const DISTINCT_ID_HEADER = "X-Lucida-Distinct-Id";
export const SESSION_ID_HEADER = "X-Lucida-Session-Id";

const MAX_LEN = 1000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Header value hygiene: strips ASCII control characters, trims, caps at 1000 chars; empty -> undefined.
 * These headers are client-controlled: use them to stitch analytics, never for authentication or authorisation.
 */
export function cleanHeader(v: string | null | undefined): string | undefined {
  const s = (v ?? "").replace(CONTROL, "").trim().slice(0, MAX_LEN);
  return s === "" ? undefined : s;
}

/** The slice of a framework request this helper reads (structural: works with Fetch, Node and Next requests). */
export interface RequestLike {
  /** Absolute URL if known, else a path. */
  url?: string | undefined;
  method?: string | undefined;
  /** Case-insensitive header lookup. */
  header(name: string): string | null | undefined;
  /** Socket peer address, used for `$ip` unless `trustProxy` is set and X-Forwarded-For is present. */
  remoteAddr?: string | null | undefined;
}

export interface RequestContext {
  distinctId?: string;
  sessionId?: string;
  /** `$current_url`, `$request_method`, `$request_path`, `$user_agent`, `$ip` (those that are known) + `$session_id`. */
  props: Props;
}

/** Distinct id, session id and request properties for server-side events. Explicit capture args should override `props`. */
export function requestContext(r: RequestLike, o: { trustProxy?: boolean } = {}): RequestContext {
  const distinctId = cleanHeader(r.header(DISTINCT_ID_HEADER));
  const sessionId = cleanHeader(r.header(SESSION_ID_HEADER));
  const props: Props = {};
  const url = cleanHeader(r.url);
  if (url) {
    props.$current_url = url;
    try {
      props.$request_path = new URL(url, "http://x").pathname;
    } catch {
      /* unparseable url: no path */
    }
  }
  const method = cleanHeader(r.method);
  if (method) props.$request_method = method.toUpperCase();
  const ua = cleanHeader(r.header("user-agent"));
  if (ua) props.$user_agent = ua;
  const fwd = o.trustProxy ? cleanHeader(r.header("x-forwarded-for")?.split(",")[0]) : undefined;
  const ip = fwd ?? cleanHeader(r.remoteAddr);
  if (ip) props.$ip = ip;
  if (sessionId) props.$session_id = sessionId;
  return { ...(distinctId ? { distinctId } : {}), ...(sessionId ? { sessionId } : {}), props };
}

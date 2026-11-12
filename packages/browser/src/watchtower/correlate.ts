import { patchRequests } from "../netpatch.js";
import { watchtowerHooks } from "./hooks.js";
import { exposeGlobalHint } from "./hint.js";
import type { Host, Module, WatchtowerLike } from "../types.js";

const KEY = "lucida.session_id";

/** Merge `lucida.session_id=<id>` into an existing W3C baggage header, replacing a stale entry. */
export function withBaggage(existing: string | null | undefined, sessionId: string): string {
  const kept = (existing ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith(`${KEY}=`));
  return [...kept, `${KEY}=${encodeURIComponent(sessionId)}`].join(",");
}

/** Same-origin always; other origins only when listed (exact origin string or RegExp on the URL). */
export function correlatable(url: string, allow: Array<string | RegExp> = []): boolean {
  let u: URL;
  try {
    u = new URL(url, location.href);
  } catch {
    return false;
  }
  return u.origin === location.origin || allow.some((a) => (typeof a === "string" ? u.origin === a : a.test(u.href)));
}

/**
 * Watchtower link: with `watchtower.correlate = true`, same-origin and
 * allowlisted fetch/XHR requests carry `baggage: lucida.session_id=<id>` so Watchtower links its
 * spans and errors to the Lucida session. Lucida's own ingest host is never touched.
 */
export const correlate: Module = (host) => {
  const w = host.config.watchtower;
  const { core } = host;
  const stopStamp = stampSession(host);
  const stopHooks = watchtowerHooks(host);
  const stopHint = exposeGlobalHint(host);
  const stop = (): void => (stopStamp?.(), stopHooks(), stopHint());
  if (!w?.correlate) return stop;
  let sid = core.sessionId;
  host.onCapture((e) => (sid = String(e.properties.$session_id ?? sid)));
  const ok = (url: string): boolean =>
    core.hasConsent("analytics") && !url.startsWith(host.config.apiHost) && correlatable(url, w.origins);

  const unpatch = patchRequests((url, headers) => {
    if (ok(url)) headers.set("baggage", withBaggage(headers.get("baggage"), sid));
  });
  return () => (unpatch(), stop());
};

/**
 * One session id across both SDKs: when a Watchtower browser client is present (`watchtower.client`, else
 * `globalThis.watchtower`) the Lucida session id is set as its `lucida.session_id` attribute, now and on every
 * rotation, once analytics consent is granted. Absent client: nothing happens.
 */
export function stampSession(host: Host): (() => void) | undefined {
  const wt = host.config.watchtower?.client ?? (globalThis as { watchtower?: WatchtowerLike }).watchtower;
  if (typeof wt?.setAttribute !== "function") return;
  const { core } = host;
  const put = (id: string): void => {
    if (core.hasConsent("analytics")) wt.setAttribute(KEY, id);
  };
  host.whenConsented(() => put(core.sessionId));
  return core.onSessionId(put);
}

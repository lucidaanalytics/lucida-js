import { patchRequests } from "./netpatch.js";
import type { Module } from "./types.js";

export const DISTINCT_ID_HEADER = "X-Lucida-Distinct-Id";
export const SESSION_ID_HEADER = "X-Lucida-Session-Id";

/** Exact hostname, or a leading-dot suffix (`.example.com` matches `example.com` and every subdomain). */
export function hostListed(url: string, hosts: readonly string[]): boolean {
  let h: string;
  try {
    h = new URL(url, location.href).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((raw) => {
    const x = raw.toLowerCase();
    return x.startsWith(".") ? h === x.slice(1) || h.endsWith(x) : h === x;
  });
}

/** Header values must be ASCII: percent-encode anything else (the server side only trims, never decodes). */
const safe = (v: string): string => (/^[\x20-\x7e]*$/.test(v) ? v : encodeURIComponent(v));

/**
 * Host headers (opt-in, `tracingHeaders: ["api.example.com", ".example.org"]`): fetch/XHR to a listed host
 * carry `X-Lucida-Distinct-Id` and `X-Lucida-Session-Id` so your own backend can stitch server events to this
 * visitor. Never sent to the Lucida ingest host, and only while analytics consent is held. Cross-origin
 * targets must allow both headers in their CORS config (they trigger a preflight).
 */
export const hostHeaders: Module = (host) => {
  const hosts = host.config.tracingHeaders;
  if (!hosts?.length) return;
  const { core } = host;
  return patchRequests((url, headers) => {
    if (!core.hasConsent("analytics") || url.startsWith(host.config.apiHost) || !hostListed(url, hosts)) return;
    if (core.distinctId) headers.set(DISTINCT_ID_HEADER, safe(core.distinctId));
    headers.set(SESSION_ID_HEADER, safe(core.sessionId));
  });
};

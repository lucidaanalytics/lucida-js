import type { Module } from "./types.js";

/**
 * Cross-domain linker: `_lcid=<distinct_id>.<base36 ms>[_<session id>]`. Unsigned and short-lived by design.
 * The session part is optional and sits after the timestamp behind `_` (never a base36 digit), so links from older
 * SDKs decode here and older SDKs still read id and time from new links (their parseInt stops at the `_`).
 */
export const LINKER_PARAM = "_lcid";
export const LINKER_TTL_MS = 2 * 60_000;

/** Exact host or any subdomain of a configured domain. */
export const hostMatches = (host: string, domains: string[]): boolean =>
  domains.some((d) => {
    const x = d.replace(/^\./, "").toLowerCase();
    return host.toLowerCase() === x || host.toLowerCase().endsWith(`.${x}`);
  });

export const encodeLinker = (id: string, now = Date.now(), sessionId?: string): string =>
  `${id}.${now.toString(36)}${sessionId ? `_${sessionId}` : ""}`;

export interface Linked {
  distinctId: string;
  sessionId?: string;
}

/** Id and (when carried) session id of a linker value, or undefined when malformed, from the future or older than 2 minutes. */
export function decodeLink(v: string, now = Date.now()): Linked | undefined {
  const i = v.lastIndexOf(".");
  const [t = "", sid] = v.slice(i + 1).split("_", 2);
  const ts = /^[0-9a-z]+$/.test(t) ? parseInt(t, 36) : NaN;
  const id = v.slice(0, i);
  if (!(i > 0 && id.length <= 200 && ts <= now + 5000 && now - ts <= LINKER_TTL_MS)) return undefined;
  return sid && /^[\w-]{1,64}$/.test(sid) ? { distinctId: id, sessionId: sid } : { distinctId: id };
}

/** The id inside a linker value (see decodeLink). */
export const decodeLinker = (v: string, now = Date.now()): string | undefined => decodeLink(v, now)?.distinctId;

/**
 * On landing: strips `_lcid` from the address bar (always, when crossDomains is configured) and
 * returns the carried id if it is fresh and the referrer, when the browser sends one, is one of
 * the configured domains. Nothing is stored here; the caller bootstraps identity, which the
 * consent-gated storage then persists only after consent. A carried session id continues the session.
 */
export function takeLinker(domains: string[] | undefined): Linked | undefined {
  if (!domains?.length) return undefined;
  const u = new URL(location.href);
  const v = u.searchParams.get(LINKER_PARAM);
  if (v === null) return undefined;
  u.searchParams.delete(LINKER_PARAM);
  history.replaceState(history.state, "", u.toString());
  try {
    if (document.referrer && !hostMatches(new URL(document.referrer).hostname, domains)) return undefined;
  } catch {
    return undefined;
  }
  return decodeLink(v);
}

/** Decorates links to the configured domains with the current distinct id and session id, only while analytics consent is held. */
export const crossDomain: Module = (host) => {
  const domains = host.config.crossDomains;
  if (!domains?.length) return;
  const decorate = (ev: MouseEvent): void => {
    const a = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
    if (!a || !host.core.hasConsent("analytics")) return;
    const el = a as HTMLAnchorElement;
    if (!/^https?:$/.test(el.protocol) || el.host === location.host || !hostMatches(el.hostname, domains)) return;
    const u = new URL(el.href);
    u.searchParams.set(LINKER_PARAM, encodeLinker(host.client.distinctId, Date.now(), host.core.sessionId));
    el.href = u.toString();
  };
  document.addEventListener("click", decorate, true);
  document.addEventListener("auxclick", decorate, true);
  return () => {
    document.removeEventListener("click", decorate, true);
    document.removeEventListener("auxclick", decorate, true);
  };
};

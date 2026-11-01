import { styleTag } from "../csp.js";
import type { Host, Module } from "../types.js";

/** Payload key on a flag / variant payload: `{ "lc_split_url": { "url": "/pricing-b" } }`. */
export const SPLIT_URL_KEY = "lc_split_url";
/** Marker added to the redirect target so the variant page never redirects again (loop guard). */
export const SPLIT_MARKER = "__lc_split";
const FLUSH_WAIT_MS = 300;

/** Redirect target for a payload, or null when it must not redirect (no url, same page, foreign origin, loop). */
export function splitTarget(payload: unknown, flag: string, loc: URL, allowedOrigins: string[] = []): URL | null {
  const raw = (payload as Record<string, { url?: unknown } | undefined> | null | undefined)?.[SPLIT_URL_KEY]?.url;
  if (typeof raw !== "string" || !raw) return null;
  let target: URL;
  try {
    target = new URL(raw, loc);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (target.origin !== loc.origin && !allowedOrigins.includes(target.origin)) return null;
  if (loc.searchParams.has(SPLIT_MARKER)) return null; // we already arrived via a split redirect
  // preserve the visitor's query and hash; the variant URL's own params win
  for (const [k, v] of loc.searchParams) if (!target.searchParams.has(k)) target.searchParams.set(k, v);
  if (!target.hash) target.hash = loc.hash;
  if (target.origin === loc.origin && target.pathname === loc.pathname && target.search === loc.search) return null;
  target.searchParams.set(SPLIT_MARKER, flag);
  return target;
}

/**
 * Split-URL tests (LC-EXT-3). When an experiment flag's assigned variant carries `lc_split_url.url`, the
 * visitor is sent to that URL with `location.replace` (no extra history entry), query and hash preserved.
 * Reading the flag records `$exposure` first and the queue is flushed (bounded wait) before navigating.
 * Config `splitUrl`: `antiFlickerMs` hides the page until flags resolve (default 0 = off), `allowedOrigins`
 * lists extra origins a variant may live on (same-origin is always allowed), `navigate` replaces
 * location.replace (tests). The target carries `__lc_split=<flag>`, which the variant page strips again.
 */
export const splitUrl: Module = (host: Host) => {
  if (typeof document === "undefined") return;
  const cfg = host.config.splitUrl ?? {};
  const loc = new URL(location.href);
  if (loc.searchParams.has(SPLIT_MARKER)) {
    loc.searchParams.delete(SPLIT_MARKER);
    history.replaceState(history.state, "", loc);
    return;
  }
  let veil: HTMLStyleElement | undefined = undefined;
  const lift = (): void => {
    veil?.remove();
    veil = undefined;
  };
  if ((cfg.antiFlickerMs ?? 0) > 0) {
    veil = styleTag("html{opacity:0 !important}", host.config.nonce);
    document.head.append(veil);
    setTimeout(lift, cfg.antiFlickerMs);
  }
  let went = false;
  const off = host.client.onFlags((f) => {
    if (went) return;
    for (const key of Object.keys(f)) {
      const t = splitTarget(host.flags?.payload(key), key, new URL(location.href), cfg.allowedOrigins);
      if (!t) continue;
      went = true;
      host.flags?.get(key); // records the $exposure
      host.log("split url redirect", key, t.href);
      const go = (): void => (cfg.navigate ?? ((u: string) => location.replace(u)))(t.href);
      void Promise.race([host.client.flush(), new Promise((r) => setTimeout(r, FLUSH_WAIT_MS))]).then(go, go);
      return;
    }
    lift();
  });
  return () => {
    off();
    lift();
  };
};

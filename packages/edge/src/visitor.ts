import { uuidv7 } from "@lucida/sdk-core";

/** First-party cookie holding the anonymous distinct id (same name as @lucida/next). */
export const DISTINCT_ID_COOKIE = "lc_distinct_id";

export interface Visitor {
  distinctId: string;
  /** True when the id was minted for this request: the caller may persist it (only with consent). */
  isNew: boolean;
}

/** The visitor's distinct id from a Cookie header, or a fresh one. Shared by the Astro and Remix wrappers. */
export function visitorId(cookieHeader: string | null | undefined, name = DISTINCT_ID_COOKIE): Visitor {
  for (const part of (cookieHeader ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name && part.length > i + 1) return { distinctId: decodeURIComponent(part.slice(i + 1)), isNew: false };
  }
  return { distinctId: uuidv7(), isNew: true };
}

const CONSENT_COOKIE = "lc_consent";

/**
 * May the anonymous id be written to a cookie? Mirrors the browser SDK: `opt_in` (default) needs the consent
 * cookie to say "granted", `opt_out` writes unless it says "denied", `off` always writes.
 */
export function mayPersist(cookieHeader: string | null | undefined, mode: "off" | "opt_in" | "opt_out" = "opt_in"): boolean {
  const consent = cookieHeader?.split(/;\s*/).find((p) => p.startsWith(`${CONSENT_COOKIE}=`))?.slice(CONSENT_COOKIE.length + 1);
  return mode === "off" || (mode === "opt_in" ? consent === "granted" : consent !== "denied");
}

/** Set-Cookie value persisting the id for a year (first-party, Lax, readable by the browser SDK). */
export const distinctIdSetCookie = (id: string, name = DISTINCT_ID_COOKIE): string =>
  `${name}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`;

/** Inline script body that hands the server's bootstrap to the browser SDK: `init(key, { bootstrap: window.__LUCIDA_BOOTSTRAP__ })`. */
export const bootstrapScript = (b: { distinctId: string; flags: Record<string, unknown> }): string =>
  `window.__LUCIDA_BOOTSTRAP__=${JSON.stringify(b).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)};`;

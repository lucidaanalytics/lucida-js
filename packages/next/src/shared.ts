import { uuidv7 } from "@lucida/sdk-core";
import type { FlagValue } from "@lucida/sdk-core";

/** Request header the middleware forwards to server components / route handlers. */
export const HEADER_ID = "x-lc-distinct-id";
export const HEADER_FLAGS = "x-lc-flags";
/** Request context (distinct id, session id, URL/method/path/user agent/ip) the middleware forwards as JSON. */
export const HEADER_CTX = "x-lc-request";
/** First-party cookie holding the anonymous distinct id (only written with consent). */
export const COOKIE_ID = "lc_distinct_id";
/** Cookie the host app's consent banner sets to "granted" / "denied". */
export const COOKIE_CONSENT = "lc_consent";

export type Flags = Record<string, FlagValue>;

/** What the server resolved for this visitor; pass it to the provider so first paint already has the right variant. */
export interface Bootstrap {
  distinctId: string;
  flags: Flags;
}

export interface LucidaNextOptions {
  /** Public project key (lc_pk_...). */
  apiKey: string;
  /** Ingest/flags host reachable from the server. Default https://app.lucida.dev */
  host?: string;
  /**
   * Mirrors the browser SDK. `opt_in` (default): the distinct-id cookie is written only when the consent cookie
   * says "granted". `opt_out`: written unless it says "denied". `off`: always.
   */
  consentMode?: "off" | "opt_in" | "opt_out";
  consentCookie?: string;
  /** Replaces the remote POST /v1/flags call (e.g. local evaluation with the node SDK, see `nodeEvaluator`). */
  evaluate?: (distinctId: string) => Promise<Flags>;
  /**
   * Set true when `lucidaMiddleware` runs on every page that calls `getBootstrap`. Only then are the forwarded
   * `x-lc-*` request headers trusted; otherwise a client could send its own and poison a cached page.
   */
  middleware?: boolean;
  /** Take `$ip` from the first X-Forwarded-For hop (only behind a proxy you control). Default false. */
  trustProxy?: boolean;
  /** Flag fetch budget; the page renders with no flags rather than waiting longer. Default 800 ms. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export const hostOf = (o: LucidaNextOptions): string => (o.host ?? "https://app.lucida.dev").replace(/\/+$/, "");

/** Cookie/consent policy for writing the anonymous id. */
export function mayStoreId(o: LucidaNextOptions, cookie: (name: string) => string | undefined): boolean {
  const mode = o.consentMode ?? "opt_in";
  const c = cookie(o.consentCookie ?? COOKIE_CONSENT);
  return mode === "off" || (mode === "opt_in" ? c === "granted" : c !== "denied");
}

interface RemoteFlag {
  enabled?: boolean;
  variant?: string;
  value?: FlagValue;
}

/** Flags for one visitor: `evaluate` if given, else POST /v1/flags with the public key. Failures yield {} (never throw). */
export async function resolveFlags(o: LucidaNextOptions, distinctId: string): Promise<Flags> {
  try {
    if (o.evaluate) return await o.evaluate(distinctId);
    const r = await (o.fetch ?? fetch)(`${hostOf(o)}/v1/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(o.timeoutMs ?? 800),
      body: JSON.stringify({ api_key: o.apiKey, distinct_id: distinctId, groups: {}, person_properties: {} }),
    });
    if (!r.ok) return {};
    const j = (await r.json()) as { flags?: Record<string, RemoteFlag | FlagValue> };
    return Object.fromEntries(
      Object.entries(j.flags ?? {}).map(([k, v]) => [k, typeof v === "object" ? (v.value ?? v.variant ?? !!v.enabled) : v]),
    );
  } catch {
    return {};
  }
}

export const newDistinctId = (): string => uuidv7();

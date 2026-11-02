import { COOKIE_ID, HEADER_ID, getBootstrap } from "@lucida-analytics/next";
import type { Bootstrap, Flags, HeadersLike, LucidaNextOptions } from "@lucida-analytics/next";
import { OVERRIDES_COOKIE, readOverrides } from "./overrides.js";

export { OVERRIDES_COOKIE, readOverrides } from "./overrides.js";

/** What `identify` returns and `decide` receives (Flags SDK "entities"). */
export interface LucidaEntities {
  distinctId: string;
}

/** The slice of `ReadonlyRequestCookies` the adapter reads. */
export interface CookiesLike {
  get(name: string): { value: string } | undefined;
}

/** Structural twin of the Flags SDK `Adapter`: `flag({ key, adapter })` accepts it without importing `flags`. */
export interface FlagsAdapter<Value, Entities> {
  origin: (key: string) => string;
  identify: (p: { headers: HeadersLike; cookies: CookiesLike }) => Promise<Entities>;
  decide: (p: { key: string; entities?: Entities; headers: HeadersLike; cookies: CookiesLike; defaultValue?: Value }) => Promise<Value>;
}

export type LucidaAdapterOptions = LucidaNextOptions & {
  /**
   * FLAGS_SECRET of the project: when set, values a teammate overrides in the Flags Explorer
   * (cookie `vercel-flag-overrides`) win over the evaluation for that visitor.
   */
  flagsSecret?: string;
};

/**
 * Flags SDK adapters backed by Lucida flags, evaluated with the visitor's distinct id (cookie, or the id the
 * middleware forwarded). Every flag of one request shares a single evaluation: the result is cached per `headers` object.
 *
 *   const lucida = lucidaAdapter({ apiKey: process.env.NEXT_PUBLIC_LUCIDA_KEY! });
 *   export const newCheckout = flag<boolean>({ key: "new-checkout", adapter: lucida.isEnabled() });
 */
export function lucidaAdapter(o: LucidaAdapterOptions) {
  const cache = new WeakMap<object, Promise<Bootstrap>>();
  const boot = (headers: HeadersLike, cookies: CookiesLike): Promise<Bootstrap> => {
    let p = cache.get(headers);
    if (!p) {
      // Prefer the cookie from the cookie store; getBootstrap reads the cookie header and the middleware headers.
      const id = cookies.get(COOKIE_ID)?.value;
      const h: HeadersLike = id && !headers.get(HEADER_ID) ? { get: (n) => (n.toLowerCase() === "cookie" ? `${COOKIE_ID}=${encodeURIComponent(id)}` : headers.get(n)) } : headers;
      p = getBootstrap(h, o);
      cache.set(headers, p);
    }
    return p;
  };
  const origin = (key: string) => `${(o.host ?? "https://app.lucida.dev").replace(/\/+$/, "")}/flags?q=${encodeURIComponent(key)}`;
  const make =
    <V>(pick: (v: Flags[string] | undefined, fallback: V | undefined) => V) =>
    (): FlagsAdapter<V, LucidaEntities> => ({
      origin,
      identify: async ({ headers, cookies }) => ({ distinctId: (await boot(headers, cookies)).distinctId }),
      decide: async ({ key, headers, cookies, defaultValue }) => {
        const over = await readOverrides(cookies.get(OVERRIDES_COOKIE)?.value, o.flagsSecret);
        if (key in over) return pick(over[key] as Flags[string], defaultValue);
        return pick((await boot(headers, cookies)).flags[key], defaultValue);
      },
    });
  return {
    /** true when the flag is on for the visitor (any variant counts as on). */
    isEnabled: make<boolean>((v, d) => (v === undefined ? (d ?? false) : v !== false && v !== "")),
    /** The multivariate key; the default (or undefined) when the flag is off or unknown. */
    variant: make<string | undefined>((v, d) => (typeof v === "string" ? v : v === true ? "true" : d)),
    /** The raw flag value, typed by the caller. */
    value: <T extends Flags[string] = Flags[string]>() => make<T | undefined>((v, d) => (v === undefined ? d : (v as T)))(),
  };
}

/** One flag as the Flags Explorer lists it. */
export interface ProviderFlag {
  description?: string;
  origin: string;
  options?: { value: boolean | string; label?: string }[];
}

interface ListedFlag {
  key: string;
  name?: string;
  description?: string;
  variants?: { key: string }[];
}

/**
 * Data for the Flags Explorer (`/.well-known/vercel/flags`): the project's flag definitions from Lucida.
 * Server only: it needs a secret or personal API key, never a public key.
 */
export async function getProviderData(o: { apiKey: string; project: string; host?: string; fetch?: typeof fetch }): Promise<{ definitions: Record<string, ProviderFlag>; hints: string[] }> {
  const host = (o.host ?? "https://app.lucida.dev").replace(/\/+$/, "");
  const res = await (o.fetch ?? fetch)(`${host}/v1/projects/${encodeURIComponent(o.project)}/flags?limit=200`, { headers: { authorization: `Bearer ${o.apiKey}` } });
  if (!res.ok) return { definitions: {}, hints: [`Lucida flags unavailable (${res.status})`] };
  const body = (await res.json()) as { data?: ListedFlag[] };
  const definitions: Record<string, ProviderFlag> = {};
  for (const f of body.data ?? []) {
    const description = f.description || f.name;
    definitions[f.key] = {
      ...(description ? { description } : {}),
      origin: `${host}/flags?q=${encodeURIComponent(f.key)}`,
      options: f.variants?.length ? f.variants.map((v) => ({ value: v.key })) : [{ value: false }, { value: true }],
    };
  }
  return { definitions, hints: [] };
}

export type { Bootstrap, Flags, HeadersLike, LucidaNextOptions };

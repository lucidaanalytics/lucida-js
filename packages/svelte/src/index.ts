import { init } from "@lucida-analytics/browser";
import type { BrowserConfig, Client, FlagValue } from "@lucida-analytics/browser";

export type Flags = Record<string, FlagValue>;

/** Svelte store contract (https://svelte.dev/docs/svelte-store): usable as `$store` with no svelte import here. */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

export interface LucidaOptions {
  client?: Client;
  apiKey?: string;
  options?: BrowserConfig;
  /** Server-resolved flags: the stores start with these (no flicker, SSR-safe). */
  bootstrapFlags?: Flags;
}

export interface LucidaStores {
  /** null during SSR and when neither client nor apiKey was given. */
  client: Client | null;
  flags: Readable<Flags>;
  /** One flag; the exposure is recorded when a subscriber sees a defined value, never at creation. */
  flag(key: string): Readable<FlagValue | undefined>;
  payload(key: string): Readable<unknown>;
  /** Consent controls for a cookie banner. In opt_in mode nothing is stored or sent until grant(). */
  consent: { grant(): void; revoke(): void; set: Client["setConsent"] };
  capture: Client["capture"];
  destroy(): void;
}

/**
 * Create the Lucida stores once (e.g. in a layout) and share them via context or a module.
 * The browser SDK is never touched on the server. Consent is the SDK's: pass options.consent.
 */
export function createLucida(o: LucidaOptions): LucidaStores {
  const client =
    o.client ??
    (o.apiKey && typeof window !== "undefined"
      ? init(o.apiKey, {
          ...o.options,
          ...(o.bootstrapFlags ? { bootstrap: { ...o.options?.bootstrap, flags: o.bootstrapFlags } } : {}),
        })
      : null);
  let current: Flags = o.bootstrapFlags ?? {};
  const subs = new Set<(f: Flags) => void>();
  const stop = client?.onFlags((f) => {
    current = f;
    subs.forEach((s) => s(f));
  });
  const flags: Readable<Flags> = {
    subscribe(run) {
      subs.add(run);
      run(current);
      return () => void subs.delete(run);
    },
  };
  const pick = <T>(read: (f: Flags) => T, expose?: string): Readable<T> => ({
    subscribe(run) {
      let last: T | typeof UNSET = UNSET;
      return flags.subscribe((f) => {
        const v = read(f);
        if (v === last) return;
        last = v;
        run(v);
        if (expose && f[expose] !== undefined) client?.getFlag(expose);
      });
    },
  });
  return {
    client,
    flags,
    flag: (key) => pick((f) => f[key], key),
    payload: (key) => pick(() => client?.getFlagPayload(key)),
    consent: {
      grant: () => client?.setConsent({ analytics: true, replay: true }),
      revoke: () => client?.setConsent({ analytics: false, replay: false, marketing: false }),
      set: (u) => client?.setConsent(u),
    },
    capture: (event, props) => client?.capture(event, props),
    destroy: () => {
      stop?.();
      subs.clear();
    },
  };
}

const UNSET = Symbol("unset");

export { routeTemplateOf, trackNavigation } from "./navigation.js";
export type { CaptureClient, NavigationLike } from "./navigation.js";

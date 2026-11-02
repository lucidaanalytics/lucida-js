import { init } from "@lucida-analytics/browser";
import type { BrowserConfig, Client, FlagValue } from "@lucida-analytics/browser";
import { inject, shallowRef } from "vue";
import type { InjectionKey, Plugin, ShallowRef } from "vue";

export type Flags = Record<string, FlagValue>;

export interface LucidaState {
  /** null during SSR and when neither client nor apiKey was given. */
  client: Client | null;
  flags: ShallowRef<Flags>;
}

export const LUCIDA_KEY: InjectionKey<LucidaState> = Symbol("lucida");

export interface LucidaPluginOptions {
  client?: Client;
  apiKey?: string;
  options?: BrowserConfig;
  /** Server-resolved flags: rendered on the server and first client render (no flicker). */
  bootstrapFlags?: Flags;
}

/**
 * `app.use(lucida, { apiKey, options })`. The browser SDK is never touched on the server. Consent
 * is the SDK's: pass `options.consent` ({ mode: "opt_in" } to wait for `useConsent().grant()`).
 */
export const lucida: Plugin<[LucidaPluginOptions]> = {
  install(app, o) {
    const client =
      o.client ??
      (o.apiKey && typeof window !== "undefined"
        ? init(o.apiKey, {
            ...o.options,
            ...(o.bootstrapFlags ? { bootstrap: { ...o.options?.bootstrap, flags: o.bootstrapFlags } } : {}),
          })
        : null);
    const flags = shallowRef<Flags>(o.bootstrapFlags ?? {});
    const stop = client?.onFlags((f) => (flags.value = f));
    if (stop) app.onUnmount(stop);
    app.provide(LUCIDA_KEY, { client, flags });
  },
};

export function useLucidaState(): LucidaState {
  const v = inject(LUCIDA_KEY, null);
  if (!v) throw new Error("Lucida composables need app.use(lucida, ...)");
  return v;
}

import type { LucidaPluginOptions } from "@lucida/vue";

/** Module options. `apiKey` is a public key (safe in client bundles); `options` is the browser SDK config. */
export type LucidaModuleOptions = Pick<LucidaPluginOptions, "apiKey" | "options" | "bootstrapFlags">;

/** The slice of the Nuxt instance the module touches (Nuxt >= 3.8), typed locally so `nuxt` stays an optional peer. */
export interface NuxtLike {
  options: {
    plugins: Array<string | { src: string; mode?: "all" | "client" | "server" }>;
    runtimeConfig: { public: Record<string, unknown> };
    build: { transpile: Array<string | RegExp> };
  };
  hook(name: "imports:extend", fn: (imports: Array<{ name: string; from: string }>) => void): void;
}

export const COMPOSABLES = ["useLucida", "useCapture", "useFlag", "useFlagPayload", "useActiveFlags", "useConsent"] as const;

/**
 * Nuxt module (a plain `(options, nuxt)` function, which Nuxt accepts): `modules: [[lucidaModule, { apiKey }]]`.
 * Registers the runtime plugin, puts the options in `runtimeConfig.public.lucida` (so `NUXT_PUBLIC_LUCIDA_API_KEY`
 * overrides it per environment) and auto-imports the @lucida/vue composables.
 */
export function lucidaModule(options: LucidaModuleOptions, nuxt: NuxtLike): void {
  const pub = nuxt.options.runtimeConfig.public;
  pub.lucida = { ...(pub.lucida as object | undefined), ...options };
  nuxt.options.plugins.push({ src: "@lucida/nuxt/runtime/plugin", mode: "all" });
  nuxt.options.build.transpile.push(/@lucida\//);
  nuxt.hook("imports:extend", (imports) => {
    for (const name of COMPOSABLES) imports.push({ name, from: "@lucida/vue" });
  });
}

import { lucida } from "@lucida/vue";
import type { LucidaPluginOptions } from "@lucida/vue";
import type { App } from "vue";

/** What the plugin needs from Nuxt: the Vue app and the public runtime config the module filled. */
export interface NuxtAppLike {
  vueApp: App;
  $config: { public: { lucida?: LucidaPluginOptions } };
}

/**
 * Nuxt plugin (plain function: `defineNuxtPlugin` is only a typing identity). Installs the Vue plugin from the
 * module options; with no `apiKey` it installs an inert client so composables never throw. The browser SDK is
 * only constructed where `window` exists, so SSR renders without touching it.
 */
export default function lucidaPlugin(nuxtApp: NuxtAppLike): void {
  nuxtApp.vueApp.use(lucida, nuxtApp.$config.public.lucida ?? {});
}

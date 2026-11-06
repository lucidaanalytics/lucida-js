# @lucida-analytics/nuxt

Nuxt 3.8+ module. It installs the Vue plugin from `@lucida-analytics/vue` in a runtime plugin, keeps the options in
`runtimeConfig.public.lucida` and auto-imports the composables. The browser SDK is only constructed where `window` exists, so SSR
never touches it.

```sh
npm install @lucida-analytics/nuxt @lucida-analytics/vue @lucida-analytics/browser
```

```ts
// nuxt.config.ts
import { lucidaModule } from "@lucida-analytics/nuxt";
export default defineNuxtConfig({
  modules: [[lucidaModule, { apiKey: "lc_pk_...", options: { apiHost: "https://<your capture host>" } }]],
});
```

```vue
<script setup lang="ts">
const checkout = useFlag("new-checkout"); // ComputedRef; the exposure is recorded after mount
const capture = useCapture();
</script>
<template><button @click="capture('cta_clicked')">{{ checkout ? "New" : "Old" }}</button></template>
```

- Module options: `apiKey` (public key), `options` (browser SDK config, including `consent`), `bootstrapFlags` (server-resolved
  flags for a flicker-free first render). `NUXT_PUBLIC_LUCIDA_API_KEY` overrides the key per environment.
- Auto-imported: `useLucida`, `useCapture`, `useFlag`, `useFlagPayload`, `useActiveFlags`, `useConsent` (also exported, with
  `COMPOSABLES`, `lucidaPlugin` and the `LucidaModuleOptions` / `NuxtLike` / `NuxtAppLike` types).
- With no `apiKey` the plugin installs an inert client, so the composables never throw.
- Consent is the SDK's: in `opt_in` mode nothing is stored or sent until `useConsent().grant()`.

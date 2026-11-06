# @lucida-analytics/vue

Vue 3.3+ plugin and composables over `@lucida-analytics/browser`. The browser SDK is never touched during SSR.

```sh
npm install @lucida-analytics/vue @lucida-analytics/browser
```

```ts
import { createApp } from "vue";
import { lucida } from "@lucida-analytics/vue";

createApp(App).use(lucida, { apiKey: "lc_pk_...", options: { apiHost: "https://<your capture host>", consent: { mode: "opt_in" } } }).mount("#app");
```

```vue
<script setup lang="ts">
import { useFlag, useCapture, useConsent } from "@lucida-analytics/vue";
const variant = useFlag("new-checkout"); // ComputedRef<FlagValue | undefined>
const capture = useCapture();
const { grant } = useConsent();
</script>
```

- Plugin options (`LucidaPluginOptions`): `apiKey`, `options` (browser SDK config), `client` (use an existing client instead),
  `bootstrapFlags` (server-resolved flags, rendered on the server and the first client render).
- Composables: `useLucida()` (the client or `null`), `useCapture()` (a no-op without a client), `useFlag(key)` (the exposure is
  recorded after mount and when the value changes, never during setup), `useFlagPayload(key)`, `useActiveFlags()` (keys that are on),
  `useConsent()` (`setConsent`, `optIn`, `optOut`, `grant`, `revoke`).
- Also exported: `LUCIDA_KEY`, types `LucidaPluginOptions`, `LucidaState`, `Flags`.
- A composable called without `app.use(lucida, ...)` throws.
- Nuxt: use `@lucida-analytics/nuxt`, which wires this plugin for you.

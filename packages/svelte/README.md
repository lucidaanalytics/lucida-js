# @lucida-analytics/svelte

Svelte and SvelteKit helpers over `@lucida-analytics/browser`: stores for flags and consent, SPA pageviews, and a server `handle`.
Two entries: `@lucida-analytics/svelte` and `@lucida-analytics/svelte/server`.

```sh
npm install @lucida-analytics/svelte @lucida-analytics/browser
```

```svelte
<!-- +layout.svelte -->
<script>
  import { afterNavigate } from "$app/navigation";
  import { createLucida, trackNavigation } from "@lucida-analytics/svelte";
  export let data;
  const lucida = createLucida({ apiKey: "lc_pk_...", options: { capturePageview: false, bootstrap: { distinctId: data.lucida.distinctId } }, bootstrapFlags: data.lucida.flags });
  trackNavigation(afterNavigate, lucida.client);
  const checkout = lucida.flag("new-checkout");
</script>
{#if $checkout}<NewCheckout />{/if}
```

```ts
// hooks.server.ts
import { createEdgeClient } from "@lucida-analytics/edge";
import { lucidaHandle } from "@lucida-analytics/svelte/server";
export const handle = lucidaHandle(createEdgeClient({ apiKey: "lc_pk_...", host: "https://capture.lucidace.com" }));
// +layout.server.ts: return { lucida: { distinctId: locals.lucida.distinctId, flags: locals.lucida.flags } }
```

- `createLucida({ apiKey | client, options, bootstrapFlags })` returns `{ client, flags, flag(key), payload(key), consent, capture, destroy }`.
  `flags`, `flag(key)` and `payload(key)` are Svelte-compatible stores (use `$store`); the exposure is recorded when a subscriber sees a
  defined value, never at creation. `consent` has `grant()`, `revoke()` and `set(update)`. Create it once, in the root layout.
- `trackNavigation(afterNavigate, client)` captures SPA pageviews with `$route` (layout groups removed) and `$referrer`; call it once during
  component init and set `capturePageview: false`. `routeTemplateOf(routeId)` is the route helper.
- `lucidaHandle(edgeClient, options?)` (server entry) resolves the visitor once per request into `event.locals.lucida`
  (`distinctId`, `flags`, `context`) and sets the anonymous-id cookie only when consent allows. Option `trustProxy: true`: the first
  `X-Forwarded-For` hop becomes `$ip`, only behind a proxy you control. Add `LucidaLocals` to `App.Locals`.
  Compose with other handles via `sequence()`. The `context` ids come from the browser: use them to stitch events, never for auth.
- SSR never loads the browser SDK; session replay starts in the browser after hydration. `@lucida-analytics/edge` is a dependency.

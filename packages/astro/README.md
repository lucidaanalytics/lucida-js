# @lucida-analytics/astro

Astro middleware on top of `@lucida-analytics/edge`. It resolves the visitor and their flags once per request into
`Astro.locals.lucida` and stores a new anonymous id cookie only when consent allows.

```sh
npm install @lucida-analytics/astro @lucida-analytics/browser
```

```ts
// src/middleware.ts
import { lucidaMiddleware } from "@lucida-analytics/astro";
export const onRequest = lucidaMiddleware({ apiKey: import.meta.env.PUBLIC_LUCIDA_KEY, host: "https://capture.lucidace.com" });
```

```astro
---
import { bootstrapScript } from "@lucida-analytics/astro";
const lc = Astro.locals.lucida; // { distinctId, flags, setCookie?, client }
---
<script is:inline set:html={bootstrapScript(lc)} />
<script>
  import { init } from "@lucida-analytics/browser";
  init("lc_pk_...", { bootstrap: window.__LUCIDA_BOOTSTRAP__ });
</script>
```

- `lucidaMiddleware(options | { client }, flagOptions?)`: pass `EdgeOptions` (`apiKey`, optional `secretKey` for local evaluation,
  `host`, ...) or an existing `EdgeClient`. `flagOptions` are the edge `BootstrapOptions`, including `consentMode`
  (`opt_in` default, `opt_out`, `off`).
- `Astro.locals.lucida` is `LucidaLocals`: `distinctId`, `flags`, `setCookie?` and the `client`, which you can use for server-side
  `client.capture(distinctId, event, props)`.
- Exports: `lucidaMiddleware`, `bootstrapScript`, types `LucidaLocals`, `AstroContextLike`, `RequestBootstrap`.

Server events and the cookie follow the edge client's rules; see `@lucida-analytics/edge`.

# @lucida-analytics/angular

`provideLucida()` registers an injectable `LucidaService` over the browser SDK (flags as `flags$` / `flag$(key)`, `client`
for everything else). It is a plain class, so no Angular compiler plugin is needed.

```ts
// main.ts
bootstrapApplication(App, { providers: [provideLucida({ apiKey: "lc_pk_...", options: { consent: { mode: "opt_in" } } })] });
```

## Server-side rendering (Angular Universal / `@angular/ssr`)

- The service never touches the browser SDK on the server: with no `window` it creates no client and every call is a
  no-op, so it is safe in `app.config.server.ts` and in server-rendered components. Nothing is sent, stored or timed on the server.
- Pageviews and the first-party id start after hydration. To avoid a flag flash, resolve flags on the server and pass them in:

  ```ts
  // server.ts (Express): evaluate once per request with the edge client
  import { createEdgeClient, requestBootstrap } from "@lucida-analytics/edge";
  const lucida = createEdgeClient({ apiKey: "lc_pk_...", host: "https://capture.lucidace.com" });
  app.get("*", async (req, res, next) => {
    const b = await requestBootstrap(lucida, req.headers.cookie, { consentMode: "opt_in" });
    if (b.setCookie) res.append("Set-Cookie", b.setCookie);
    // hand the bootstrap to the app through an injection token
    commonEngine.render({ ..., providers: [{ provide: LUCIDA_BOOTSTRAP, useValue: b }] }).then((html) => res.send(html));
  });

  // app.config.ts
  provideLucida({ apiKey: "lc_pk_...", options: { bootstrap: { distinctId: b.distinctId } }, bootstrapFlags: b.flags })
  ```

  `bootstrapFlags` render on the server and in the first client render, so the page does not flicker from the control to a variant.
- Do the lookup in a factory (`useFactory` with `inject(LUCIDA_BOOTSTRAP, { optional: true })`) so the same `app.config.ts`
  serves the browser build with no bootstrap.
- Session replay and autocapture only run in the browser; do not call `client.replay.start()` from server code.
- Server-side events (API routes in the same Express app): use `@lucida-analytics/node`, and read the visitor with
  `requestContext` from `@lucida-analytics/node`, which understands the `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` headers the browser SDK sends
  when you list your API host in `tracingHeaders`. Those headers are client-controlled: stitch analytics, never authenticate.
- Consent: the anonymous-id cookie from `requestBootstrap` is only emitted when consent allows (`consentMode`).

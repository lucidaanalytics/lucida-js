# @lucida-analytics/edge

Fetch-only Lucida client for edge runtimes (Cloudflare Workers, Vercel Edge, Deno, Fastly Compute). No timers and no Node APIs:
flag definitions are fetched lazily and cached per isolate for `ttlMs` (default 30 s), flags evaluate locally with the shared
evaluator, and only what cannot be decided locally (cohort filters) falls back to `POST /v1/flags`. The Astro, Remix and SvelteKit
wrappers are built on it.

```sh
npm install @lucida-analytics/edge
```

```ts
import { createEdgeClient, optionsFromEnv } from "@lucida-analytics/edge";

export default {
  async fetch(req: Request, env: Record<string, string>, ctx: ExecutionContext) {
    // LUCIDA_API_KEY (required), LUCIDA_SECRET_KEY (enables local evaluation), LUCIDA_HOST
    const lc = createEdgeClient(optionsFromEnv(env, { waitUntil: (p) => ctx.waitUntil(p) }));
    const on = await lc.isFeatureEnabled("new-checkout", "user_123");
    lc.capture("user_123", "checkout_viewed", { variant: on ? "new" : "old" });
    return new Response(on ? "new" : "old");
  },
};
```

## Client

`createEdgeClient(options)` returns an `EdgeClient`. Options: `apiKey` (public key), `secretKey` (local evaluation; never ship it
to a browser), `host`, `ttlMs`, `timeoutMs`, `fetch`, `waitUntil`, `appContexts`.

- Flags: `evaluate(distinctId)` (value and payload per flag; failures yield `{}`, never a throw), `getAllFlags`, `getFlag`,
  `isFeatureEnabled`, `getFlagPayload`, `evaluateFlags` (a `FlagSnapshot` to read freely and pass to `capture`).
- `capture(distinctId, event, properties?, { flags?, ... })` sends one event with a generated `uuid`, so the gateway dedupes a
  retried caller (delivery is at-least-once). `waitUntil` finishes it after the response; without it `await lc.flush()`.

## Visitor and bootstrap helpers

`visitorId(cookieHeader)` reads or mints the `lc_distinct_id` cookie id. `mayPersist(cookieHeader, mode)` says whether consent
(`opt_in` default, `opt_out`, `off`) allows writing it. `distinctIdSetCookie(id)` is the `Set-Cookie` value.
`requestBootstrap(client, cookieHeader, opts)` returns `{ distinctId, flags, setCookie? }` for one request, and
`bootstrapScript(bootstrap)` is the inline script body that hands it to the browser SDK:
`init(key, { bootstrap: window.__LUCIDA_BOOTSTRAP__ })`.

Privacy: the anonymous-id cookie is only written when `setCookie` is present, which needs consent.

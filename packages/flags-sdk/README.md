# @lucida-analytics/flags-sdk

Lucida adapter for the Vercel [Flags SDK](https://flags-sdk.dev) (`flags/next`) and the Flags Explorer. It builds on
`@lucida-analytics/next`, evaluates flags with the visitor's distinct id (cookie, or the id the Next middleware forwarded), and shares
one evaluation between all flags of a request.

```sh
npm install @lucida-analytics/flags-sdk @lucida-analytics/next flags
```

```ts
import { flag } from "flags/next";
import { lucidaAdapter } from "@lucida-analytics/flags-sdk";

const lucida = lucidaAdapter({ apiKey: process.env.NEXT_PUBLIC_LUCIDA_KEY!, flagsSecret: process.env.FLAGS_SECRET });

export const newCheckout = flag<boolean>({ key: "new-checkout", adapter: lucida.isEnabled() });
export const checkoutVariant = flag<string | undefined>({ key: "checkout-variant", adapter: lucida.variant() });
```

- `lucidaAdapter(options)`: `options` are the `@lucida-analytics/next` options (`apiKey`, `host`, `middleware`, ...) plus `flagsSecret`.
  Returns `isEnabled()` (true for any variant), `variant()` (the multivariate key; `undefined` when off), `value<T>()` (the raw value).
- Flags Explorer: with `flagsSecret` set, a value a teammate overrides in the Explorer (cookie `vercel-flag-overrides`) wins for that
  visitor. `OVERRIDES_COOKIE` and `readOverrides(cookie, secret)` are exported.
- `getProviderData({ apiKey, project, host? })` lists the project's flag definitions for `/.well-known/vercel/flags`. Server only: it needs
  a secret or personal API key, never a public key.

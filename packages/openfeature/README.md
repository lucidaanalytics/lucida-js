# @lucida-analytics/openfeature

OpenFeature providers backed by Lucida flags: `LucidaServerProvider` (over `@lucida-analytics/node`) and `LucidaWebProvider` (over
`@lucida-analytics/browser`). The package takes a client by structure, so it does not import either SDK or the OpenFeature SDK; install
the ones you use.

```sh
npm install @lucida-analytics/openfeature @openfeature/server-sdk @lucida-analytics/node
```

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { Lucida } from "@lucida-analytics/node";
import { LucidaServerProvider } from "@lucida-analytics/openfeature";

const lucida = new Lucida("lc_pk_...", { secretKey: "lc_sk_..." });
await OpenFeature.setProviderAndWait(new LucidaServerProvider(lucida));
const on = await OpenFeature.getClient().getBooleanValue("new-checkout", false, { targetingKey: "user_123", plan: "pro" });
```

```ts
// browser (static context)
import { OpenFeature } from "@openfeature/web-sdk";
import { init } from "@lucida-analytics/browser";
import { LucidaWebProvider } from "@lucida-analytics/openfeature";
await OpenFeature.setProviderAndWait(new LucidaWebProvider(init("lc_pk_...")));
await OpenFeature.setContext({ targetingKey: "user_123" }); // identifies, applies groups and person properties, reloads flags
```

- The targeting key is the Lucida distinct id; other context attributes become person properties, with `groups` and
  `groupProperties` feeding Lucida groups. The web provider evaluates synchronously from the loaded flags after the context is set.
- Provider events: READY after the first definitions load, CONFIGURATION_CHANGED on reload, STALE when a reload fails (see
  `ProviderEvents`, `listenerFor`).
- Raw Lucida reasons map to OpenFeature reasons through `REASONS` / `mapReason`; flag metadata carries Lucida's reason, condition index,
  request id and whether it was evaluated locally. Errors use the OpenFeature codes (`FLAG_NOT_FOUND`, `TYPE_MISMATCH`, ...).
- `track(...)` captures a Lucida event named by the tracking event name, with the details as properties and `$value` from `details.value`.
- Other languages have their own providers: `sdks/go/openfeature`, `sdks/java-openfeature`, `sdks/php-openfeature`,
  `sdks/ruby-openfeature`, `sdks/rust-openfeature`, and the Python SDK's `lucida.openfeature_provider`.

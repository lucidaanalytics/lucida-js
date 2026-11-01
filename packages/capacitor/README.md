# @lucida/capacitor

> Build-host note: this package was written without running a compiler, the tests or a Capacitor app.
> Verify with `pnpm install`, `pnpm --filter @lucida/capacitor typecheck`, `pnpm --filter @lucida/capacitor test`,
> then a smoke run in an iOS and an Android Capacitor app (events in Live events, `$os`, lifecycle events).

Lucida for Capacitor apps, built on `@lucida/sdk-core` (same wire format, consent gate, queue and retry as the
browser and React Native SDKs). It does not depend on `@capacitor/core`: pass the plugins you already use, or the
SDK reads them from the `window.Capacitor` bridge.

```ts
import { Preferences } from "@capacitor/preferences";
import { App } from "@capacitor/app";
import { createClient } from "@lucida/capacitor";

const lucida = await createClient("lc_pk_...", {
  apiHost: "https://app.lucida.dev",
  preferences: Preferences, // persistence (identity, session, consent, flag cache, offline queue)
  app: App,                 // $app_opened / $app_backgrounded
  appVersion: "1.4.0",
  consent: { mode: "opt_in" },
});

lucida.optIn();             // opt_in: nothing is captured or written to Preferences before this
lucida.capture("level_complete", { level: 3 });
lucida.screen("Shop");
lucida.identify("user-42", { plan: "pro" });
if (lucida.isFeatureEnabled("new-shop")) { /* ... */ }
```

- Events: `POST /v1/batch` with `{api_key, batch, sent_at}`, a UUIDv7 per event (server dedupe), `$lib: "lucida-capacitor"`,
  `$os` from `Capacitor.getPlatform()`. Flush at 20 events or 5 s, exponential backoff with jitter, at-least-once.
- Batches that fail on the network are parked in Preferences (`lucida.lc_offline`) and drained on the next foreground.
- Flags: `POST /v1/flags`, last response cached; `$feature/<key>` rides on every event (`sendFeatureFlags: false` to stop).
- Lifecycle: `$app_opened` (`from_background`) at start and on every return, `$app_backgrounded` plus a flush.
- Privacy: consent defaults to `opt_out` like every Lucida SDK; `$lc_*` properties are stripped client-side; no form or
  input values are collected.

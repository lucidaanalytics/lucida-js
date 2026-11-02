# @lucida-analytics/cordova

Lucida for Cordova and Ionic (Cordova) apps: analytics, feature flags and session replay. The plugin is a thin bridge:
`cordova.plugins.lucida` calls `cordova.exec`, and the native side delegates to the Lucida SDKs
(`sdks/android` as `io.github.lucidaanalytics:lucida-android`, `sdks/ios` as the `Lucida` pod), so queueing, retry,
identity, consent, flags and replay behave exactly as in the native apps. Capacitor apps use `@lucida-analytics/capacitor` instead.

```sh
cordova plugin add @lucida-analytics/cordova      # Android (cordova-android 12+, Kotlin) and iOS 15+ (cordova-ios 7+)
```

```js
document.addEventListener("deviceready", async () => {
  const lucida = cordova.plugins.lucida;
  await lucida.init("lc_pk_YOUR_KEY", {
    apiHost: "https://ingest.example.com",
    consent: { mode: "opt_in" },        // nothing is stored or sent until optIn() / setConsent({ analytics: true })
    replay: { enabled: true, maskAllText: true, sampleRate: 0.25 },
  });
  lucida.screen("Home");
  lucida.identify("user-42", { plan: "pro" });
  if (await lucida.isFeatureEnabled("new-onboarding")) { /* ... */ }
});
```

Ionic with TypeScript: `import type { LucidaCordova } from "@lucida-analytics/cordova/types"` and
`const lucida = (window as any).cordova.plugins.lucida as LucidaCordova`.

## API

Every method returns a promise. Call them after `deviceready`.

| Area | Methods |
| --- | --- |
| Setup | `init(apiKey, { apiHost, consent: { mode, queueBeforeConsent }, flushAt, flushIntervalMs, maxQueueSize, debug, appVersion, replay })` |
| Capture | `capture(event, props)`, `screen(name, props)`, `flush()` |
| Identity | `identify(id, set, setOnce)`, `alias(id)`, `group(type, key, props)`, `reset()`, `getDistinctId()`, `getAnonymousId()` |
| Super props | `register(props)`, `registerOnce(props)`, `unregister(key)` |
| Consent | `optIn()`, `optOut()`, `setConsent({ analytics, replay, marketing })`, `isOptedOut()` |
| Flags | `getFlag(key)`, `isFeatureEnabled(key)`, `getFlagPayload(key)`, `reloadFlags()`, `onFlags(cb)` |
| Replay | `startReplay()`, `stopReplay()`, `pauseReplay()`, `resumeReplay()`, `isReplayActive()` |

Properties starting with `$lc_` are reserved for the gateway and dropped before they reach native code.

## Behaviour to know

- **Consent**: default `opt_out` like every Lucida SDK; use `opt_in` for GDPR-style opt-in. Replay also needs the
  `replay` consent category (`optIn()` grants all three).
- **Replay** is off unless `replay.enabled`. It is the native wireframe recorder: text, inputs and images are masked by
  default, WebView content is a box (a Cordova app is one WebView, so a replay shows the WebView frame, not the DOM). To
  see the DOM in an Ionic/Cordova app, also load the web SDK (`@lucida-analytics/browser`) in the WebView with
  `consent.mode: "opt_in"` and let consent drive both.
- **Screens**: Cordova is a single native Activity/ViewController, so call `screen("Name")` on route changes
  (the Ionic router `NavigationEnd` event is a good place). Native lifecycle events (`$app_opened`,
  `$app_backgrounded`, flush on background) come from the native SDKs; the first-launch foreground event can be missed
  on Android because the plugin initialises after the Activity started.
- **Flags**: `onFlags` keeps a native listener open for the app session and fires after every refresh.

## Tests

`pnpm --filter @lucida-analytics/cordova test` runs the bridge unit tests (a fake `cordova.exec`). The Kotlin and Swift sources
call only methods that exist in `sdks/android` and `sdks/ios`; they need a Cordova project to compile, which this
repository's CI does not have. Smoke test: `cordova create app && cordova platform add android ios && cordova plugin add
./sdks/cordova`, then open the live events view.

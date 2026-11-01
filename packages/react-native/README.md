# @lucida/react-native

React Native SDK on top of `@lucida/sdk-core` (queue, batching, retry, identity, sessions, consent,
local flag evaluation). Native modules are injected, never imported, so the package has no native
dependency and tests run without React Native.

```tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { LucidaProvider, useFeatureFlag, useCapture } from "@lucida/react-native";

<LucidaProvider apiKey="lc_pk_..." options={{
  apiHost: "https://ingest.example.com",
  asyncStorage: AsyncStorage, appState: AppState,
  appVersion: "1.4.0", platform: "ios",
}}>
  <App />
</LucidaProvider>
```

Or imperatively: `const client = await createClient(key, config)` (storage hydrates first, hence async).

## Features

- **Capture**: `POST /v1/batch`, 20 events / 5 s, retry with backoff, offline batches persisted to
  AsyncStorage (`offlineTransport`). No gzip (React Native has no `CompressionStream`).
- **Lifecycle** (`appState` adapter): `$app_opened`, `$app_backgrounded` (flushes),
  `$app_installed`, `$app_updated` (needs `appVersion`).
- **Identity/consent**: `identify`, `alias`, `reset`, `register*`, `group`, `optIn`/`optOut`. With
  `consent: { mode: "opt_in" }` nothing is written to AsyncStorage or sent before consent.
- **Flags**: `localFlags` evaluated on device (same evaluator and vectors as the web SDK), the rest via
  `POST /v1/flags`. Hooks: `useFeatureFlag`, `useFeatureFlagVariant`, `useFeatureFlagPayload`,
  `useActiveFeatureFlags`, `FeatureGate`.
- **Screens**: `useScreen("Home")`, or react-navigation (optional peer):

```tsx
const ref = useNavigationContainerRef();
const { onReady, onStateChange } = screenTracker(client, ref);
<NavigationContainer ref={ref} onReady={onReady} onStateChange={onStateChange} />
```

Route params are not sent unless `includeParams: true` (they often contain PII).

## Hooks, person profiles, flags, privacy, autocapture

- `beforeSend: [hook, ...]`: ordered `(event) => event | null`; return a changed event to amend, `null` to drop. A hook that throws is
  logged (when `debug`) and skipped: the event continues as it was before that hook. `sampleHook(0.1)` keeps ~10% and adds `$sample_rate`.
  Hooks run as events enter the queue (a wrapper on the queue's `enqueue`, since `@lucida/sdk-core` is shared with the web SDK).
- `personProfiles`: `"always"` (default), `"identified_only"` (events carry `$process_person_profile: false` until identify, alias, group or
  a person-property write; persisted, cleared by `reset()`), `"never"` (identify/alias/setPersonProperties are no-ops with a debug warning, `$set` is stripped).
- Flags: `flagOptions: { bootstrap: { distinctId, isIdentified, flags, payloads }, sendFeatureFlagEvent, preload, evaluationContexts }`,
  `disableRemoteFeatureFlags: true` (never calls `/v1/flags`) with `client.updateFlags(flags, payloads, { merge })` for flags your own backend
  evaluated, `onFlags`, `setPersonPropertiesForFlags(props, reload?)`, `setGroupPropertiesForFlags`, reset variants.
- Queue/network: `flushAt`, `flushIntervalMs`, `maxQueueSize`, `maxBatchSize`, `maxRetries`, `retryDelayMs`, `requestTimeoutMs`,
  `dataMode: "wifi"` + `network: { isWifi() }` (inject NetInfo), `sessionIdleMs` / `sessionMaxMs`, `disableGeoip`, `disabled`, `client.debug(true)`.
- Person helpers: `setPersonProperties`, `capture(event, props, { set, setOnce })`, `getAnonymousId`, `reuseAnonymousId`, `isOptedOut`, `openURL(url, referrer)` (`$deep_link_opened`).
- Tracing headers: `tracingHeaders: ["api.example.com", ".corp.io"]`, then call your backend through `client.fetch` to add
  `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` (never to the Lucida host; analytics consent required).
- Autocapture: `autocapture: { enabled: true, ignoreLabels, maxElements, propsAllowList, customLabelProp, noCaptureProp, rageTap }`, then
  `<View onTouchEnd={touchHandler(client.autocapture)}>` at the root. Elements are the touched fiber's ancestors that carry an
  `accessibilityLabel` / `testID`; `<View lucidaNoCapture>` excludes a subtree. It reads React internals (`_targetInst`), so treat it as best effort.
  Text-field values are never read. `$rageclick` fires after repeated taps.
- Replay privacy: `replay: { maskText, maskAllTextInputs, maskAllImages, maskSandboxedViews, sampleRate, throttleMs }` (the native modules receive the mask flags),
  `client.replay.start()/stop()/isRecording()`.

Not built: push registration (needs a scope decision).

## Session replay (wireframe)

Off by default. The native view hierarchy is encoded natively by the Lucida iOS / Android SDK wireframe
encoder (inputs and secure fields never carry text; other text is starred unless `maskText: false`); this package
owns consent (analytics **and** replay), session/window ids, `seq` (resets when the session rotates), structure
dedupe and delivery to `POST /v1/replay`.

```tsx
import { NativeModules } from "react-native";
createClient("lc_pk_...", { replay: { enabled: true, module: NativeModules.LucidaReplay, snapshotIntervalMs: 5000 } });
```

Screenshot mode: `replay: { mode: "screenshot", screenshotQuality: 0.4 }`. The native module draws the window into a
bitmap, paints inputs, secure fields, `<LucidaMask>` views, images and (unless `maskText: false`) text over, and only then
encodes JPEG (the same `ScreenshotCapture` / `UIKitScreenshot` code the native SDKs use); at most one frame a second.

Native contract (`NativeReplayModule` in `src/replay.ts`): `captureWireframe({ screen, maskText, maskAllTextInputs, maskAllImages, maskSandboxedViews }): Promise<string>` (plus `mode: "screenshot", screenshotQuality` in screenshot mode)
resolves JSON text `{"width","height","events":[meta (type 4), fullSnapshot (type 2)]}`, or `""` when nothing can
be captured. Reference implementations, linked as ordinary React Native native modules:

- iOS: `ios/LucidaReplay.swift` + `.m`, calling `ReplayBridge.capture` from the `Lucida` Swift package (add it as a pod/SPM dependency).
- Android: `android/src/main/kotlin/com/lucida/reactnative/LucidaReplayModule.kt`, calling `WireframeCapture.capture`
  from `lucida-android`; register the module in a `ReactPackage` of your app.

These two files are not compiled in this repository (no React Native toolchain); everything they call is covered
by `swift test` (ReplayBridgeTests) and `make sdk-android` (ReplayBridgeTest). Verify them in a real app before shipping.

### Encrypting the offline queue at rest

The same native module exposes two blocking synchronous methods, `encryptQueue` / `decryptQueue`: AES-256-GCM with a key the
platform keeps (iOS Keychain via the iOS SDK's `KeychainQueueCipher`, Android Keystore via `KeystoreQueueCipher`), generated on
first use. Wire it with `nativeQueueCipher`:

```ts
createClient("lc_pk_...", { asyncStorage, queueCipher: nativeQueueCipher(NativeModules.LucidaReplay) });
```

Only the offline queue (`lc_offline`) is encrypted. A lost or rotated key reads as an empty queue, and a native failure on
encrypt stores an empty value, never plaintext. Blocking sync methods need JSI, so they do not work under the remote JS debugger.
Covered by `test/native-cipher.test.ts` (native module mocked with real AES-GCM); the native halves are verified in step 5 below.

### Verifying the native modules in a real app (G35)

Not done in this repository (no RN toolchain, no Xcode/Gradle builds on the dev disk). Exact steps:

1. `npx @react-native-community/cli init LucidaProbe` (RN >= 0.74), then `pnpm add file:<repo>/sdks/react-native` (or `pnpm pack` it).
2. iOS: add the `Lucida` Swift package (`sdks/ios`) via SPM, copy `ios/LucidaReplay.swift` and `LucidaReplay.m` into the app target
   (create a bridging header if Xcode asks), `cd ios && pod install`, build for a simulator. Expect: it compiles; `NativeModules.LucidaReplay.captureWireframe({screen:"Home",maskText:true})` resolves JSON starting `{"width"`.
3. Android: add `include ':lucida-android'` / `project(':lucida-android').projectDir = new File('<repo>/sdks/android/lucida-android')` and the `lucida-core` module,
   copy `android/src/main/kotlin/com/lucida/reactnative/*.kt`, register the package in `MainApplication`, `./gradlew :app:assembleDebug`. Expect the same JSON.
4. In JS: `createClient("lc_pk_...", { replay: { enabled: true, module: NativeModules.LucidaReplay }, flagStream: true })`, grant consent, open a screen, and confirm
   `POST /v1/replay` chunks arrive and `GET /v1/flags/stream` connects (RN's `fetch` usually cannot stream response bodies; then the SDK silently polls every `pollMs`).
5. Queue cipher: with `queueCipher: nativeQueueCipher(NativeModules.LucidaReplay)` go offline, capture an event, and confirm the `lc_offline` AsyncStorage value is
   opaque base64 (no event name in it) and that the event is delivered after reconnecting and an app restart.
6. Native unit coverage that exists today: `swift test` (sdks/ios, ReplayBridgeTests) and `make sdk-android` (ReplayBridgeTest).

## Out of scope

Push registration and attribution.

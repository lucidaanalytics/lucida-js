# Changelog

## 0.2.1

- Declining consent while identified sends one identified `$consent_updated` (categories false, `$set` `$consent_analytics`/`$consent_replay` `denied`) before capture stops, so server-side consent gating can drop the person's server events.

## 0.2.0

- BREAKING: UI components (`LucidaGuides`, `GuideAnchor`, `LucidaMask`, `LucidaUnmask`, `LucidaTouchCapture`, `measureAnchor`, `registerAnchor`,
  `replayMarker`, `REPLAY_MARKERS`) moved from the root to `@lucida-analytics/react-native/ui`. The root no longer imports `react-native`.
- Autolinking: podspec, `android/build.gradle`, `LucidaReactPackage`, `react-native.config.js`; Expo config plugin `app.plugin.js`.
- `useExpoRouterScreens` (`/expo-router`), storage adapters `/storage/expo-file-system`, `/storage/expo-secure-store`, `/storage/mmkv`.
- `optIn()` / `optOut()` write the `$consent_updated` consent log like the browser SDK (`consent.policyVersion`, `consent.logBeacon`).
- `@lucida-analytics/sdk-core` is now a caret range (`^0.1.3`) instead of an exact pin.

## 0.1.2

- Export `package.json`; default hosts move to lucidace.com.

## 0.1.x (earlier)

- Durable replay spool with split chunks and torn-write detection; AdServices retries.
- Install attribution on `$app_installed`; `onIntervention`; guides (anchored steps, hotspots, carousel, theme tokens).
- Masked screens, text patterns, dead swipes, controlled exposure; screenshot replay; native queue cipher.
- `beforeSend`, `personProfiles`, flag bootstrap, `updateFlags`, autocapture, tracing headers; `getFlagResult`.
- Initial React Native client on sdk-core (queue, identity, sessions, consent, local flag evaluation), react-navigation `screenTracker`.

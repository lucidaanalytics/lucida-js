# @lucida-analytics/expo

Lucida for Expo apps: analytics, feature flags, guides and session replay. It is `@lucida-analytics/react-native` with the Expo wiring done for you: storage (`expo-file-system`), app state, the app version from `app.json`, the platform and OS version, and the native module when the app has one.

- **Expo Go:** analytics, identify, flags and guides work. Session replay and install attribution need native code, so they are off (with one warning if you turn replay on).
- **Development and release builds** (`npx expo run:ios`, EAS Build): everything, including replay.

## Install

```sh
npx expo install @lucida-analytics/expo @lucida-analytics/react-native expo-constants expo-application expo-file-system
```

For replay, add the config plugin to `app.json` and rebuild: `"plugins": ["@lucida-analytics/expo"]`.

## Use

```tsx
import { LucidaProvider, useCapture, useFeatureFlag } from "@lucida-analytics/expo";

export default function RootLayout() {
  return (
    <LucidaProvider apiKey="lc_pk_..." options={{ replay: { enabled: true } }}>
      <Stack />
    </LucidaProvider>
  );
}
```

Screens with Expo Router (one `$screen` per route template, such as `/profile/[id]`, never the real id):

```tsx
import { useLucida } from "@lucida-analytics/expo";
import { useExpoRouterScreens } from "@lucida-analytics/expo/router";

function Screens() { useExpoRouterScreens(useLucida()); return null; }
```

Every option of `@lucida-analytics/react-native` is accepted and wins over the Expo default; `replay` takes the same options without `module`. Everything else that package exports (hooks, `FeatureGate`, `createClient`) is exported here too. See its README for the full reference.

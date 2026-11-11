# @lucida-analytics/react

React 18+ provider and hooks over `@lucida-analytics/browser`. SSR-safe: the browser SDK is never touched on the server, and the
owned client is cached per `apiKey` so StrictMode double renders do not create two.

```sh
npm install @lucida-analytics/react @lucida-analytics/browser
```

```tsx
import { LucidaProvider, useFeatureFlag, useCapture, FeatureGate } from "@lucida-analytics/react";

<LucidaProvider apiKey="lc_pk_..." options={{ apiHost: "https://<your capture host>" }}>
  <App />
</LucidaProvider>;

function Buy() {
  const capture = useCapture();
  const variant = useFeatureFlag("new-checkout");
  return <button onClick={() => capture("buy_clicked")}>{variant ? "New" : "Old"}</button>;
}
```

- `LucidaProvider` props: `apiKey`, `options` (browser SDK config), `client` (use an existing one), `bootstrapFlags` (server-resolved
  flags: rendered on the server and the first client render, no flicker).
- Hooks: `useLucida()` (the client or `null`), `useCapture()`, `useFeatureFlag(key)` (the exposure is recorded after mount, never during
  render), `useFeatureFlagVariant(key)`, `useFeatureFlagPayload(key)`, `useActiveFeatureFlags()`, `useSessionId()` (re-renders when the session rotates), `useDistinctId()` (read at render), `useConsent()` (`status`, `hasOptedIn`, `hasOptedOut`, `optIn`, `optOut`, `setConsent`; re-renders on every change), `useReplay()` (start, stop, pause,
  resume, tag, isRecording; inert on the server), `useEarlyAccess()` (`features`, `optIn`, `optOut`; needs the browser `earlyAccess` module).
- Components: `FeatureGate` (`flag`, `variant?`, `fallback?`), `Feature` (a flag-gated block that sends `$feature_view` once when it
  scrolls into view and `$feature_interaction` on the first click; `trackView` and `trackInteraction` turn each off), `CaptureOnViewed`
  (sends `$element_viewed`, or your `event`, when it becomes visible; `repeat` to send every time).
- Frameworks: `@lucida-analytics/next`, `@lucida-analytics/react-router` and `@lucida-analytics/tanstack-start` build on this package.

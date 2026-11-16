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

### One-line tag

```tsx
<LucidaTag uid={user?.id} />
```

Props: `publicKey` (default `process.env.NEXT_PUBLIC_LUCIDA_KEY`), `uid`, `options`, `modules`, `cookieMunch` (default true).

- Inert without a key: renders nothing and imports nothing. Next inlines `NEXT_PUBLIC_*` at build time, so a key set only at runtime ships empty.
- Never throws: a failed load or init resolves to nothing; init runs once per key, even under StrictMode.
- Defaults: `consent.mode: "opt_in"`, `referralParams: []`, `exposeGlobal: true`; your `options` win. Browser SDK and consent code load lazily.

- `LucidaProvider` props: `apiKey`, `options` (browser SDK config), `client` (use an existing one), `bootstrapFlags` (server-resolved
  flags: rendered on the server and the first client render, no flicker).
- Hooks: `useLucida()` (the client or `null`), `useCapture()`, `useFeatureFlag(key)` (the exposure is recorded after mount, never during
  render), `useFeatureFlagVariant(key)`, `useFeatureFlagPayload(key)`, `useActiveFeatureFlags()`, `useSessionId()` (re-renders when the session rotates), `useDistinctId()` (read at render), `useConsent()` (`status`, `hasOptedIn`, `hasOptedOut`, `optIn`, `optOut`, `setConsent`; re-renders on every change), `useReplay()` (start, stop, pause,
  resume, tag, isRecording; inert on the server), `useEarlyAccess()` (`features`, `optIn`, `optOut`; needs the browser `earlyAccess` module).
- Components: `FeatureGate` (`flag`, `variant?`, `fallback?`), `Feature` (a flag-gated block that sends `$feature_view` once when it
  scrolls into view and `$feature_interaction` on the first click; `trackView` and `trackInteraction` turn each off), `CaptureOnViewed`
  (sends `$element_viewed`, or your `event`, when it becomes visible; `repeat` to send every time).
- Frameworks: `@lucida-analytics/next`, `@lucida-analytics/react-router` and `@lucida-analytics/tanstack-start` build on this package.

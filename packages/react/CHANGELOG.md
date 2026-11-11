# Changelog: @lucida-analytics/react

Built from the git history of `sdks/react` and its version bumps.

## 0.1.3 (2026-11-11)

Added:
- `LucidaProvider` takes `modules`, passed as the third `init` argument (for example `[cookieMunchConsent]`).

## 0.1.2 (2026-11-10)

Added in 0.1.2: bindings for `exposeGlobal`, server no-op client, consent status and id/consent hooks (`useConsent`, `useDistinctId`, `useSessionId`).

## 0.1.1 (2026-11-09)

Added in 0.1.1 (fixes): peer ranges for `react` and the browser package.

## 0.1.0 (2026-11-01)

First release under the `@lucida-analytics` scope. Added in 0.1.0: `LucidaProvider`, `useLucida`, `useCapture`, `useFeatureFlag`, `useFeatureFlagVariant`, `useFeatureFlagPayload`, `useActiveFeatureFlags`, `useReplay`, `FeatureGate`, `Feature`, `CaptureOnViewed`, `useEarlyAccess`, server-rendered bootstrap flags.

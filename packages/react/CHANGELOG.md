# Changelog: @lucida-analytics/react

Built from the git history of `sdks/react` and its version bumps.

## 0.1.6 (2026-11-18)

Added:
- `identify` and `identifyProps` on `LucidaProvider` and `LucidaTag`, and the `useIdentityTransition(client, id, props)` hook: identify when the id becomes a non-empty string, `reset()` only on a signed-in to signed-out transition.

## 0.1.5

- The built bundle starts with `"use client"`, so `import { LucidaTag } from "@lucida-analytics/react"` works from a React Server Component (Next App Router `app/layout.tsx`) with no wrapper file.

## 0.1.4 (2026-11-16)

Added:
- `LucidaTag`: a one-line, consent-gated loader (lazy `import`, init memoised per key, never throws, renders nothing).

## 0.1.3 (2026-11-11)

Added:
- `LucidaProvider` takes `modules`, passed as the third `init` argument (for example `[cookieMunchConsent]`).

## 0.1.2 (2026-11-10)

Added in 0.1.2: bindings for `exposeGlobal`, server no-op client, consent status and id/consent hooks (`useConsent`, `useDistinctId`, `useSessionId`).

## 0.1.1 (2026-11-09)

Added in 0.1.1 (fixes): peer ranges for `react` and the browser package.

## 0.1.0 (2026-11-01)

First release under the `@lucida-analytics` scope. Added in 0.1.0: `LucidaProvider`, `useLucida`, `useCapture`, `useFeatureFlag`, `useFeatureFlagVariant`, `useFeatureFlagPayload`, `useActiveFeatureFlags`, `useReplay`, `FeatureGate`, `Feature`, `CaptureOnViewed`, `useEarlyAccess`, server-rendered bootstrap flags.

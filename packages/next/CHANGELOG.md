# Changelog: @lucida-analytics/next

Built from the git history of `sdks/next` and its version bumps.

## 0.1.7 (2026-11-25)

Added:
- `withLucidaRewrites(config)` for `next.config`: adds the rewrites and the `NEXT_PUBLIC_LUCIDA_REWRITE` marker.

Fixed:
- `LucidaNextProvider` no longer fails silently without the rewrite: `apiHost` defaults to `/ingest` only when the marker is set, else `https://capture.lucidace.com`; in development the first 404 from a same-origin `apiHost` logs one console.error.

## 0.1.6 (2026-11-18)

Added:
- `LucidaNextProvider` and `LucidaPagesProvider` take `identify` (your signed-in user id) and `identifyProps`: identify on sign-in, `reset()` on sign-out only.

## 0.1.5 (2026-11-11)

Added:
- `LucidaNextProvider` and `LucidaPagesProvider` take `modules` (third `init` argument), for example the Cookie Munch bridge.
- `lucidaMiddleware` accepts `consent(req) => boolean | undefined`; without it the `lc_consent` cookie written by the browser SDK's CMP bridges is used.
- README and help pages cover `proxy.ts` (Next 16).

## 0.1.4 (2026-11-10)

Added in 0.1.4: `exposeGlobal` on by default in `LucidaNextProvider` (`window.lucida`), consent and id hooks from the browser SDK.

## 0.1.3 (2026-11-09)

Added in 0.1.3 (fixes): peer ranges.

## 0.1.2 (2026-11-07)

Added in 0.1.2: `package.json` exported.

## 0.1.1 (2026-11-06)

Added in 0.1.1: default host moves to `lucidace.com`.

## 0.1.0 (2026-11-01)

First release under the `@lucida-analytics` scope. Added in 0.1.0: `lucidaMiddleware` (flicker-free bootstrap, consent-gated `lc_distinct_id` cookie), `getBootstrap`, `LucidaNextProvider`, `LucidaPagesProvider`, `withLucida` / `getServerSideLucida`, `lucidaRewrites` (first-party `/ingest`), `$route` templates (`routeTemplates`), server request context (`getRequestContext`), `nodeEvaluator` local flag evaluation.

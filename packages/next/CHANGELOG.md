# Changelog: @lucida-analytics/next

Built from the git history of `sdks/next` and its version bumps.

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

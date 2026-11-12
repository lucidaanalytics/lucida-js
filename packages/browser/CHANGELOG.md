# Changelog: @lucida-analytics/browser

Built from the git history of `sdks/browser` and its version bumps. Dates are the bump commit dates.

## 0.1.9 (2026-11-11)

BEHAVIOUR CHANGE: `referralParams` is now OFF by default. In 0.1.8 it was on (`ref`, `referral`, `via`, `aff`) and recorded `$referral_code` / `initial_referral_code` under Lucida's analytics consent, which is not the consent category referral platforms use. If you relied on it, set `referralParams: ["ref"]` (or `{ params: [...] }`) explicitly.

Added:
- `referralParams: { params?: string[], category?: string }`: with `category: "referrals"` the code is recorded only once that consent-manager category is granted. The Cookie Munch and Cookiebot bridges now pass every named category of a decision through (`host.categoryGrants`). The string array form still works and follows analytics consent.
- One console hint (once per page) when Watchtower's SDK is on the page (`globalThis.watchtower` or `watchtower:ready`) while `exposeGlobal` is off: Watchtower cannot find Lucida without it.
- `lucida-embed.json`, a Cookie Munch embed-v1 manifest generated from `storage.json` (`node scripts/gen-embed-manifest.mjs`), served at `https://lucidace.com/.well-known/lucida-embed.json` for the Cookie Munch `lucida` preset. `storage.json` gains `updated`.

Compliance note, cookie and storage names (unchanged by this release, now published in the manifest): `lc_consent` (necessary; the unsuffixed first-party cookie written by consent-manager bridges, and `lc_consent_<suffix>` in the SDK's persistence), `lc_distinct_id` (statistics cookie, written by a bridge only after analytics is granted), plus every `lc_*_<suffix>` statistics key listed in `storage.json`.

## 0.1.8 (2026-11-11)

Added:
- `referralParams` (default `["ref", "referral", "via", "aff"]`): first `$pageview` of a session sets `$referral_code` and the person property `initial_referral_code`.
- CMP bridges write the first-party cookie `lc_consent=granted|denied` on every decision (never before one), and on a grant the anonymous id as `lc_distinct_id`; a denial removes it. `@lucida-analytics/next` reads them.
- `$consent_updated` carries `consent_receipt_id` when Cookie Munch exposes a receipt or ledger id.
- `cookieMunchBridge({ replayCategory })`: a custom Cookie Munch category that gates replay separately from `statistics`.
- Published typings no longer carry internal notes (`scripts/check-dist-notes.mjs` guards the release).

## 0.1.7 (2026-11-10)

Added in 0.1.7:
- Watchtower error and vital hooks: `$exception_seen` and `$web_vitals` events from a Watchtower client that has `on("error")` / `on("vital")`, after analytics consent.
- `autocapture_inputs` project setting; SRI manifest keys equal the served paths; the SDK fetches its config when Watchtower owns replay.

## 0.1.6 (2026-11-10)

Added in 0.1.6:
- `exposeGlobal: true | "name"` (`globalThis.lucida`, `lucida:ready`).
- A no-op client on the server (no `window`) with the same shape.
- `hasOptedIn()`, `onConsent(cb)`, `consentStatus()`; Watchtower session stamp (`lucida.session_id`).

## 0.1.5 (2026-11-10)

Added in 0.1.5:
- Consent precedence: stored decision, then the project's `consent_mode` and geo default, then the page's `consent.mode`, then `opt_out`; the project can only be stricter.
- Cache headers and an SRI manifest for the static files, a storage manifest (`storage.json`), an HTML snippet.

## 0.1.4 (2026-11-09)

Added in 0.1.4 (fixes): `optIn()` never grants marketing; peer ranges; replay URL patterns and an owner warning; a single shared types chunk; rrweb and fflate moved to dev-only dependencies.

## 0.1.3 (2026-11-09)

Added in 0.1.3: replay console and network capture.

## 0.1.2 (2026-11-07)

Added in 0.1.2: `package.json` exported from the package.

## 0.1.1 (2026-11-06)

Added in 0.1.1:
- `cookieMunchConsent` bridge, Cookie Munch-aware consent purge on deny.
- `urlPrivacy` and default masking of sensitive URL query parameters; fixed-length input masking.
- Default hosts moved to `lucidace.com`, a 404 warning; script-origin `assetHost` / `uiHost`.
- Wider bot user-agent list with `blockedUserAgents`; replay chunk `Retry-After`; cookie storage falls back to memory when cookies are blocked; `pageview` path/search/hash selection, `scrollRoot`, more click ids; flag reload coalescing; `beforeSend` that throws drops the event; replay `data-lc-fixed`, immediate re-mask on route change; guides in nested iframes; device class from UA and client hints.

## 0.1.0 (2026-11-01)

First release under the `@lucida-analytics` scope. Added in 0.1.0: core client and `init` / `createClient`, autocapture (clicks, outbound links, downloads, site search, rage and dead clicks), flags and experiments, replay, heatmaps, forms, guides, early access, recommendations, WebMCP, the consent banner and the TCF, Consent Mode, OneTrust, Cookiebot, Osano and Usercentrics bridges, storage modes, `beforeSend`, `personProfiles`, cross-domain linking, Watchtower correlation (`watchtower.correlate`), CSP `nonce`, `assetHost`.

# Changelog: @lucida-analytics/node

## 0.1.6 (2026-11-25)

Added:
- `tenantEvent(events, opts?)`: aggregate, cookieless tenant analytics events from your server (`POST /v1/projects/{id}/tenant-events`; key from `LUCIDA_SECRET_KEY`, project from `LUCIDA_PROJECT_ID`). Never throws.
- `assignVariant(bucketId, experiment)` and `tenantBucket()`: local, deterministic tenant experiment assignment (sha256 of `<experiment id>.<bucket id>`), no network call, no cookie.

Fixed:
- `LIB_VERSION` matches the package version.

## 0.1.5 (2026-11-25)

Added:
- `new Lucida()` and `captureImmediate` read `LUCIDA_SECRET_KEY` (fallback `LUCIDA_KEY`) when no key is passed.
- `consentFromCookie(header)` and `CONSENT_COOKIE`; `captureImmediate` option `consentFromCookies` (Cookie header or a `cookies()` store) stamps `$consent_analytics` on the event and person, and skips the send when denied.

## 0.1.4 (2026-11-19)

Added:
- `captureImmediate(event, opts?)` root export: one POST, never throws, 5 s timeout, key from `LUCIDA_SECRET_KEY`, host from `LUCIDA_HOST`.

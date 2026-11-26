# Changelog: @lucida-analytics/node

## 0.1.5 (2026-11-25)

Added:
- `new Lucida()` and `captureImmediate` read `LUCIDA_SECRET_KEY` (fallback `LUCIDA_KEY`) when no key is passed.
- `consentFromCookie(header)` and `CONSENT_COOKIE`; `captureImmediate` option `consentFromCookies` (Cookie header or a `cookies()` store) stamps `$consent_analytics` on the event and person, and skips the send when denied.

## 0.1.4 (2026-11-19)

Added:
- `captureImmediate(event, opts?)` root export: one POST, never throws, 5 s timeout, key from `LUCIDA_SECRET_KEY`, host from `LUCIDA_HOST`.

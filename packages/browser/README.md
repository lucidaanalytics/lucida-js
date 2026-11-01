# @lucida/browser

Browser SDK: core client plus opt-in modules (each its own entry, tree-shakeable).

```ts
import { createClient, autocapture } from "@lucida/browser";
import { replay } from "@lucida/browser/replay"; // loader only; rrweb loads lazily
import { heatmaps } from "@lucida/browser/heatmaps";
import { forms } from "@lucida/browser/forms";
createClient("lc_pk_...", { apiHost: "https://ingest.example.com" }, [autocapture, heatmaps, forms, replay]);
```

Privacy defaults: inputs masked in replay, no form values ever collected, consent respected
before any storage write. `[data-lc-ignore]` hides a subtree from every module,
`[data-lc-mask]` masks text in replay, `[data-lc-block]` replaces an element with a placeholder.
`replay: { mask_all_text: true, unmask_selectors: [".menu"] }` masks every text node and text attribute in the browser except
inside `[data-lc-unmask]` or the unmask list (a mask selector inside still wins); the project setting `replay_mask_all_text` forces it on.

## Wire contract

- **Replay**: `POST /v1/replay?compression=gzip`, body `{api_key, session_id, window_id, seq, events}`;
  `seq` is monotonic per window and resets when the session rotates. The gateway accepts up to
  10 MB decompressed (full DOM snapshots); the SDK drops a single event above that. A custom
  rrweb event `page_height` carries the document height for scroll-depth math.
- **Clicks** (`$autocapture`): `$selector`, `$el_interactive`, `$click_x/$click_y` (page px),
  `$click_el_x/$click_el_y`, `$el_width/$el_height`, `$viewport_bucket`. `$rageclick`,
  `$deadclick` and `$frustration` are derived server-side (`selector`, `x_ratio`, `y_px`,
  `viewport_bucket`, `$pathname`); the browser never emits them.
- **Scroll depth**: `$pageleave` carries `$scroll_depth` (%) and `$scroll_depth_px`.
- **Forms**: `$form_start {form}`, `$form_field_interact {form, field, interaction_ms,
  refill_count, error}`, `$form_submit {form}`, `$form_abandon {form, last_field}`. `form` and
  `field` are 12-hex hashes of name/id/label; values are never read.
- **Toolbar**: opens on `?__lc_toolbar=<token>`; the token is stripped from the URL and exchanged
  once at `POST /v1/toolbar/exchange` with `{token, origin}`, returning
  `{token, project_id, scopes, origin, expires_at}`. The returned token is the bearer for
  project-scoped calls (`/v1/projects/{id}/actions`, `/heatmaps`). Rejected token: nothing mounts.
  Launch it from the app (Settings > Toolbar: authorized origins, Launch, bookmarklet) or from code with
  `client.loadToolbar(token)` when your framework rewrites the URL first; `#__lc_toolbar=<token>` in the hash also works.
  Behind a reverse proxy that only forwards capture, set `uiHost` to the Lucida API host the toolbar should call.
  Panels: multi-element **actions** (each picked element is an OR alternative with editable selector, text, link and
  page conditions; `toolbar.dataAttributes` sets the selector's attribute preference) and an overlay of existing
  actions (numbered boxes, counts, edit, delete); **heatmap** (click, rage, dead, move, scrollmap; numbered element
  boxes with click and rage counts, "Create action" from a box, Load more / Load all, match links by URL); **flag
  overrides** (search, on/off or any variant, reload prompt); **event debugger** (local only: search or `/regex/`,
  category, pause, pin, copy, export JSON, relative time). A toolbar `read` member gets a view-only session.
  **CSP**: allow the API host (or `uiHost`) in `connect-src`; the toolbar needs no extra `script-src` (its panels are
  bundled chunks of this SDK) and renders in a shadow root, so `style-src` must permit inline style attributes
  (`'unsafe-inline'` for attributes, or `style-src-attr 'unsafe-inline'`). The in-app heatmap viewer renders a
  recording, not your live site, so it needs no `frame-ancestors` change on your site.
  The **Guide builder** (lazy chunk, LC-ENG-7) picks elements with the inspector (selector preference: `data-lc-id`,
  `data-testid`/`data-test`/`data-cy`/`data-qa`, `#id`, structural), previews with the SDK renderer (no events), and saves via
  `POST/PUT /v1/projects/{id}/guides`. Toolbar sessions carry `guides:write`. All guide kinds are offered, plus an image URL and alt text.
- **Experiment editor** (lazy chunk, LC-EXT-37): opens on `?__lc_toolbar=<token>&__lc_edit=<experiment id>` (scope `experiments:write`). It picks a variant, records point-and-click changes (optionally for this page only), saves them to a draft experiment and adds click goals. `?lc_preview=<flag>:<variant>` forces a variant for QA without recording exposure.
- **Banners and changelog** (LC-ENG-8): `banner` guides render top or bottom (`steps[0].placement: "bottom"`), dismissible,
  one engagement at a time via the arbiter. `client.guides.showChangelog()` lists banner guides (returns the count, 0 = none).
- **Guides depth** (LC-ENG-10 to 18, `@lucida/browser/guides`): `hotspot`, `beacon`, `badge` and `launcher` guides stay on the
  page (lazy `persistent` chunk). Step `buttons[].goto` / `branch` rules (person properties) jump forward; a step with `url`
  pauses a tour until that page, and tours / checklists resume on the next page (consent-gated storage). Targeting adds
  `devices`, `person_filters`, `group_filters` (from `group(type, key, props)`), `seen_guides` / `not_seen_guides`, `schedule`
  (window, weekdays, local hours), `frequency` and gateway-resolved `cohort_ids` / `exclude_cohort_ids`. Guides sharing `ab_group`
  are A/B variants (`ab_weight`); `holdout_pct` people get `$guide_holdout` and no guide, the control for goal impact.
  `steps[].i18n` picks text by `config.guides.locale`, person property `locale`, then the browser language. Checklist items
  with `complete_on: {event, props?}` tick themselves from captured events, also when the list is not on screen.

## Experiments and early access

- **Split URL** (`splitUrl` from `@lucida/browser/experiments`): a variant payload `{"lc_split_url": {"url": "/pricing-b"}}`
  sends visitors assigned that variant there with `location.replace`, before paint when `splitUrl.antiFlickerMs` hides the page.
  Query and hash are kept (the variant URL's own params win), the target gets `__lc_split=<flag>` (stripped on arrival; it
  prevents loops), only same-origin or `splitUrl.allowedOrigins` targets are followed, and `$exposure` is flushed first.
- **Early access** (`earlyAccess` from `@lucida/browser/early-access`): `client.earlyAccess.list()` reads
  `GET /v1/early-access?api_key=` (`{features: [{flag_key, name, description, stage}]}`, a gateway endpoint that does not
  exist yet) and marks local enrolment; `optIn(key)`/`optOut(key)` capture `$early_access_opt_in {$feature_flag, $enrolled}`
  with the person property `$feature_enrollment/<key>` and reload flags.

## Link, search, privacy and identity options

- **Outbound / downloads / site search** (autocapture config, each on by default): `outboundLinks` emits `$outbound_click
  {$url, $outbound_host}`; `fileDownloads` (`false`, or your own extension list; default pdf, zip, office, csv, dmg, exe, mp3,
  mp4 ...) emits `$file_download {$url, $file_name, $file_extension}`; `siteSearch` (`false`, or `{params: [...]}`, default
  `q`, `s`, `search`, `query`) emits `$site_search {$search_term, $search_param}` after each `$pageview` that carries a
  query param. Reported URLs drop query and hash. `[data-lc-ignore]` subtrees are skipped. `tag404(client)` (from
  `@lucida/browser`) on a 404 page captures `$page_not_found {$status: 404}`.
- **DNT / GPC**: `respectDnt` (default false) and `respectGpc` (default false). When set and the browser sends the signal,
  an `opt_out` project starts with consent denied, so nothing is stored or sent until `setConsent`. An explicit stored
  decision still wins. (`consent.respectDnt` is kept and enables both.)
- **Consent state**: `client.getConsent()` returns the current decision per category; `client.getConsentStatus(category?)`
  is `pending` until the visitor chose (stored or `setConsent`), then `granted` or `denied`, so a banner can show only
  while pending. `consent.storageKey` (default `lc_consent`) names the stored decision; `cookie: { domain: ".example.com" }`
  (or `crossSubdomain: true`) shares identity, session and the decision across subdomains.
- **Cross-domain**: `crossDomains: ["shop.example.com"]` (exact host or subdomains; list the other site on both sides). While
  analytics consent is held, clicks on links to those hosts get `_lcid=<distinct_id>.<base36 ms>_<session id>`. On landing the
  SDK strips `_lcid` from the address bar and, if it is under 2 minutes old and the referrer (when sent) is a configured
  domain, adopts that id and session for a first-time visitor (an existing id or session is kept). Links from older SDKs
  (no session part) still work, and older SDKs read new links. The value is unsigned by design: treat it as identity
  continuity, not authentication.
- **Internal traffic**: `client.optOutInternal()` stores an exclude-me flag (consent-gated) and adds `$internal: true` to
  every event from that browser; `optOutInternal(false)` undoes it. The toolbar has a toggle. `$lc_*` properties are stripped
  at the gateway, hence `$internal`: lc-worker must drop or flag these events.

## Event hooks, person modes and request controls

- **`beforeSend`** (one hook or an array): runs on every event right before it is queued, in order, each on the previous
  output. Return the (amended) event, or `null` to drop it. A hook that throws is logged and skipped. `sampleRate: 0.1` keeps
  10% and stamps `$sample_rate` (the `sampleHook(rate)` helper is exported to compose with your own filter);
  `propertyDenylist: ["email"]` removes those keys from properties, `$set` and `$set_once`. They run before your hooks.
- **`personProfiles`**: `"always"` (default), `"identified_only"` (events carry `$process_person_profile: false` until
  `identify`, `alias`, `group` or `setPersonProperties`; the state is stored after consent and cleared by `reset()`), or
  `"never"` (always personless; `identify`/`alias`/`setPersonProperties` do nothing). `$identify`, `$create_alias` and
  `$groupidentify` are always processed. Person writes riding on a personless event are not sent, except `$set_once`
  values (initial referrer, campaign, click ids): those are kept (first value wins, consent-gated) and sent with the first
  person-processed event. `createPersonProfile()` switches an `identified_only` visitor to a person without `identify`.
  `reuseAnonymousId: true` makes `reset()` keep this device's first anonymous id.
- **Methods**: `setPersonProperties(set, setOnce)` / `unsetPersonProperties(keys)` (send a `$set` event),
  `getSessionId()`, `onSessionId(cb)` (now and on every rotation), `getProperty(key)`, `hasOptedOut()`,
  `reset(resetDeviceId)`, `getReplayUrl({withTimestamp, timestampLookBackSeconds})` (uses `uiHost`, else `apiHost`),
  `debug(on)` (also `?__lucida_debug=1`), `featureView(flag)` / `featureInteraction(flag)` (`$feature_view` /
  `$feature_interaction`, marking the person `$feature_view/<flag>`), `updateFlags(flags, payloads, {merge})`.
- **`capture(event, props, options)`**: `timestamp` (epoch ms, ISO string or Date), `sendInstantly` (flush now),
  `transport: "beacon"` (flush with sendBeacon).
- **`bootstrap`**: `{distinctId, isIdentified, sessionId, flags, payloads}`. A stored identity or session always wins
  over bootstrap values, so a returning browser keeps its own; `isIdentified` means the id is a signed-in user.
- **Tracing headers**: `tracingHeaders: ["api.example.com", ".example.org"]` (exact host, or a leading-dot suffix) adds
  `X-Lucida-Distinct-Id` and `X-Lucida-Session-Id` to fetch/XHR to those hosts. Opt-in, only while analytics consent is
  held, never sent to the ingest host; cross-origin targets must allow both headers in CORS. Server SDKs read them with
  `requestContext`; they are client-controlled, so never use them for auth.
- **Limits and sessions**: `rateLimit: {eventsPerSecond: 10, burst: 100}` (off by default) is a client token bucket; drops
  are reported as one `$$client_ingestion_warning {$dropped_count}` per minute. `onCapture` listeners (inspector, replay
  triggers) only see events that passed `beforeSend`, sampling and the limit;
  `session: {idleMs, maxMs}` changes the 30 min idle / 24 h rotation; `customCampaignParams: ["ref_code"]` adds
  `$ref_code` (and `$initial_ref_code`) on pageviews.
- **Transport**: `disableBeacon`, `requestHeaders` (adds a CORS preflight to the ingest host), `onRequestError({url, status})`,
  `rewritePath: (path) => path` (renames every request path on `apiHost` / `flagsApiHost`, for proxies). Every event carries
  `$lib_custom_api_host` when `apiHost` is not the Lucida default, so proxy coverage is measurable.
- **Storage**: `persistence: "cookie" | "localStorage" | "sessionStorage" | "localStorage+cookie" | "memory" | "none"`.
  `localStorage+cookie` keeps identity, session, device id and consent in a cookie and localStorage (cookie wins on
  conflict, either fills in for the other) and everything else in localStorage. `persistedProperties: ["plan"]` persists only
  those super properties; `storageWriteDelayMs` coalesces writes (flushed on page hide); `flagPersistence` and
  `consentPersistence` give the flag cache and the consent decision their own store; `cookieless: "always" | "on_reject"`.
  All writes stay behind consent.
- **Runtime config**: `client.setConfig(partial)` merges options one level deep; per-event options (debug, autocapture
  options, hooks, sampling, denylist, rate limit, persisted properties) apply at once.
- **Delivery**: `assetHost` + `modules: ["replay", ...]` (classic script only) load versioned modules from
  `<assetHost>/static/v<version>/`; `nonce` goes on every injected `<style>`; `extension: true` (auto on extension pages) for
  Manifest V3. See docs/guides/sdk-pinning.md, csp.md and browser-extension.md.
- **Cookies**: `cookie: {secure, expiryDays, crossSubdomain, domain}`. `crossSubdomain` probes for the broadest parent domain
  the browser accepts (on first write, which is after consent); all cookie writes stay behind consent.
- **Pageleave**: `capturePageleave: true | false | "if_capture_pageview"` (default).
- **Autocapture**: `elementAllowlist: ["a", "button"]`, `attributeIgnore: ["data-*", "title", "href"]`,
  `maskAllAttributes` + `attributeAllowlist` (every attribute value in `$elements` reads `***` except the allowlist),
  `urlIgnorelist: ["/admin", /\/checkout\//]` (autocapture off on those pages), `contentEditable` (default on: an edited
  region is reported on blur, chain only), `copyCut` (`$copy_autocapture {$copy_type}`, default off) with
  `captureCopiedText` (`$selected_content`, digits and emails masked, 255 chars), and `data-lc-attr-<name>="v"` on an
  element or ancestor adds `<name>: "v"` to its events.
  `rageClicks: false | {count, radiusPx, windowMs, ignoreSelectors, ignoreTextSelection, suppressSteppers, stepperSelectors}`
  (`.lc-no-rageclick` always opts out; steppers such as number inputs, +/- and carousel arrows never count unless
  `suppressSteppers: false`), `deadClicks: false | {waitMs, ignoreSelectors}` (a scroll or selection change counts as a reaction).
- **Flags**: `flagsApiHost` (separate origin for `/v1/flags`), `flagOptions: {timeoutMs, refreshMs, keys, evaluationContexts,
  disableRemote}`. `keys` scopes both the request (`flag_keys`) and what the client exposes; `disableRemote` leaves values to
  bootstrap, `localFlags` and `updateFlags`.

## Develop

`pnpm test` (jsdom), `pnpm e2e` (builds, then real Chromium via Playwright against a stub
ingest server), `pnpm size` (bundle budgets).

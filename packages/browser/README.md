# @lucida-analytics/browser

Browser SDK: core client plus opt-in modules (each its own entry, tree-shakeable).

```ts
import { createClient, autocapture } from "@lucida-analytics/browser";
import { replay } from "@lucida-analytics/browser/replay"; // loader only; rrweb loads lazily
import { heatmaps } from "@lucida-analytics/browser/heatmaps";
import { forms } from "@lucida-analytics/browser/forms";
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
- **Guides depth** (LC-ENG-10 to 18, `@lucida-analytics/browser/guides`): `hotspot`, `beacon`, `badge` and `launcher` guides stay on the
  page (lazy `persistent` chunk). Step `buttons[].goto` / `branch` rules (person properties) jump forward; a step with `url`
  pauses a tour until that page, and tours / checklists resume on the next page (consent-gated storage). Targeting adds
  `devices`, `person_filters`, `group_filters` (from `group(type, key, props)`), `seen_guides` / `not_seen_guides`, `schedule`
  (window, weekdays, local hours), `frequency` and gateway-resolved `cohort_ids` / `exclude_cohort_ids`. Guides sharing `ab_group`
  are A/B variants (`ab_weight`); `holdout_pct` people get `$guide_holdout` and no guide, the control for goal impact.
  `steps[].i18n` picks text by `config.guides.locale`, person property `locale`, then the browser language. Checklist items
  with `complete_on: {event, props?}` tick themselves from captured events, also when the list is not on screen.
- **Guide behaviour extras** (W11): `branch[].op` also `element_present` / `element_absent` (CSS selector, checked when Next is
  pressed) and `flag_on` / `flag_off` (evaluated flags). Buttons `action: "snooze"` (`snooze_hours` 1..720, kept with the guide
  state and synced across devices), step `advance: "input"` (moves on when the target field fires `change`; the value is never
  read), `auto_close_s` (dismissed with `reason: "auto_close"`), `confetti` on the last step (skipped under reduced motion) and
  `automation: {action: click|focus|fill, selector, value?}` (never on `input[type=password]`, `[data-lc-mask]`, `.lc-mask`,
  `[autocomplete^=cc-]`; values never read). Kinds `carousel` (dot pager, Back / Next, arrow keys, swipe) and `form_validation`
  (`validation: {selector, rules}` checked on blur and submit; a failing submit is held back and only
  `$guide_validation_failed {rule}` is sent, never a value). `appearance.theme_mode` (auto / light / dark) with
  `appearance.dark.tokens` and the gateway-resolved theme `font_family`. Anchored steps that never find their target send
  `$guide_target_missing {step_id, selector}`.
- **Guide permalinks**: `?lc_guide=<id>` opens that guide at once (no delay) when the gateway served it and its targeting
  passes; the param is stripped with `history.replaceState`, and nothing runs before consent.
- **Resource-center AI answers**: a `search` module asks `POST /v1/guides/answer` (publishable key; 503 = no LLM, the box hides
  and plain search stays), shows the answer, https citations, suggested guides and Helpful / Not helpful. Each search sends
  `$guide_search {query_length, results, answered, feedback?}`; the query text only with the project setting
  `guide_search_capture_query`.
- **Guides in iframes**: in a child frame set `guides.renderInTop: "https://app.example.com"` (the top origin); in the top
  window set `guides.frameOrigins: ["https://embed.example.com"]`. The child keeps targeting, state and events and posts its
  guides to the top window, which draws them over the whole page with target rects mapped through the iframe position.
  Messages go to one exact origin and are accepted only from the expected window and origin.
- **Toolbar guide tools**: "Record clicks" turns a click path (across page loads in the tab) into tour steps with stable
  selectors and step urls, then `POST /v1/projects/{id}/guides/draft` writes the copy (a plain recorded tour when the route
  fails); "Draft from prompt" asks the same route; "Derive theme from this page" reads computed body / primary-button styles
  and saves `POST /guide-themes`. Automation targets and form-validation fields are checked in the page before saving.

## Experiments and early access

- **Split URL** (`splitUrl` from `@lucida-analytics/browser/experiments`): a variant payload `{"lc_split_url": {"url": "/pricing-b"}}`
  sends visitors assigned that variant there with `location.replace`, before paint when `splitUrl.antiFlickerMs` hides the page.
  Query and hash are kept (the variant URL's own params win), the target gets `__lc_split=<flag>` (stripped on arrival; it
  prevents loops), only same-origin or `splitUrl.allowedOrigins` targets are followed, and `$exposure` is flushed first.
- **Early access** (`earlyAccess` from `@lucida-analytics/browser/early-access`): `client.earlyAccess.list()` reads
  `GET /v1/early-access?api_key=` (`{features: [{flag_key, name, description, stage}]}`, a gateway endpoint that does not
  exist yet) and marks local enrolment; `optIn(key)`/`optOut(key)` capture `$early_access_opt_in {$feature_flag, $enrolled}`
  with the person property `$feature_enrollment/<key>` and reload flags.

## Link, search, privacy and identity options

- **Outbound / downloads / site search** (autocapture config, each on by default): `outboundLinks` emits `$outbound_click
  {$url, $outbound_host}`; `fileDownloads` (`false`, or your own extension list; default pdf, zip, office, csv, dmg, exe, mp3,
  mp4 ...) emits `$file_download {$url, $file_name, $file_extension}`; `siteSearch` (`false`, or `{params: [...]}`, default
  `q`, `s`, `search`, `query`) emits `$site_search {$search_term, $search_param}` after each `$pageview` that carries a
  query param. Reported URLs drop query and hash. `[data-lc-ignore]` subtrees are skipped. `tag404(client)` (from
  `@lucida-analytics/browser`) on a 404 page captures `$page_not_found {$status: 404}`.
- **Consent default is `opt_out`**: with no `consent` config the SDK stores and sends from the first page view, before any
  visitor choice. Where consent law applies (EU/UK/other opt-in regions) pass `consent: { mode: "opt_in" }` (nothing is stored
  or sent until `optIn()` / `setConsent`), or `consent: { geo: ... }` to switch by region. `optIn()` grants analytics and replay;
  marketing only with `optIn(["analytics", "replay", "marketing"])`.
- **Consent precedence** (0.1.5): a stored visitor decision wins; then the project's `consent_mode` (and geo `consent_default`)
  from `GET /v1/config`; then the page's `consent.mode`; then the SDK default (`opt_out`). The project can only make it
  stricter: a project `opt_in` beats a page `opt_out` (or no `consent` config at all), and a project `opt_out` never loosens a
  page `opt_in`. Unless the page says `opt_in`, the SDK therefore reads the config first (one `GET` carrying only the public
  key, no cookies) and holds every storage write and every send, events kept in memory, until it answers. If it does not answer
  within 3 seconds, or answers with a network error or a 5xx, the SDK fails closed as `opt_in`; `flush()` waits for the answer.
  Conformance vector: `testdata/consent/precedence.json`.
- **DNT / GPC**: `respectDnt` (default false) and `respectGpc` (default false). When set and the browser sends the signal,
  an `opt_out` project starts with consent denied, so nothing is stored or sent until `setConsent`. An explicit stored
  decision still wins. (`consent.respectDnt` is kept and enables both.)
- **Cookie Munch**: `import { cookieMunchConsent } from "@lucida-analytics/browser/consent"` and pass it as a module; it follows
  `CookieMunch.consent` after the visitor's decision (`statistics` -> analytics + replay, `marketing` -> marketing). See `docs/guides/cookie-munch.md`.
- **Consent state**: `client.getConsent()` returns the current decision per category; `client.getConsentStatus(category?)`
  is `pending` until the visitor chose (stored or `setConsent`), then `granted` or `denied`, so a banner can show only
  while pending. `consent.storageKey` (default `lc_consent`) names the stored decision; `cookie: { domain: ".example.com" }`
  (or `crossSubdomain: true`) shares identity, session and the decision across subdomains. While `pending` no `lc_*` cookie or
  storage item is written; on a denial the SDK removes the `lc_*` items stored earlier **except the decision itself** (`lc_consent_<suffix>`).
- **Cross-domain**: `crossDomains: ["shop.example.com"]` (exact host or subdomains; list the other site on both sides). While
  analytics consent is held, clicks on links to those hosts get `_lcid=<distinct_id>.<base36 ms>_<session id>`. On landing the
  SDK strips `_lcid` from the address bar and, if it is under 2 minutes old and the referrer (when sent) is a configured
  domain, adopts that id and session for a first-time visitor (an existing id or session is kept). Links from older SDKs
  (no session part) still work, and older SDKs read new links. The value is unsigned by design: treat it as identity
  continuity, not authentication.
- **Internal traffic**: `client.optOutInternal()` stores an exclude-me flag (consent-gated) and adds `$internal: true` to
  every event from that browser; `optOutInternal(false)` undoes it. The toolbar has a toggle. `$lc_*` properties are stripped
  at the gateway, hence `$internal`: lc-worker must drop or flag these events.

## Snapshot properties, page privacy rules and agent actions

- **Snapshot properties** (no code, set in project settings or picked in the toolbar): each rule reads an element's visible
  text (whitespace collapsed, at most 255 characters) or one attribute onto `$autocapture` clicks and/or `$pageview` as
  `<name>`. `scope: "target"` reads the match nearest the clicked element, `url` limits the rule to matching pages. Form
  fields, editable or masked elements, `value`/`password`/`on*` attributes and card-like digit runs are never read. SPA
  pageviews wait one tick so the new page renders; the first pageview of a hard load can miss values the page renders later.
- **Page privacy rules** (`replay.url_privacy_rules`, or `replay_url_privacy_rules` from the remote config): `[{url,
  mask_all_text?, mask_selectors?, block_selectors?}]`. On matching pages the recorder adds those masks on top of the global
  policy and restarts recording with a fresh full snapshot when the rule set changes on navigation. Patterns use the URL
  blocklist syntax (`*` wildcard, `re:` regex).
- **WebMCP agent actions** (`import { webmcp } from "@lucida-analytics/browser/webmcp"`, add it to `modules`): wraps
  `navigator.modelContext.provideContext` / `registerTool` so each tool call an AI agent makes on the page captures
  `$agent_action {tool, status: ok|error, duration_ms, $agent_protocol: "webmcp"}`. Tool arguments and results are never
  sent. From the first call the session is marked: every later event carries `$agent_session: true`, and the enricher sets
  `$agent_source = webmcp` so replays and insights can filter agent-driven sessions.

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
  `reset(resetDeviceId)`, `getReplayUrl({withTimestamp, timestampLookBackSeconds})` (uses `uiHost`, else `apiHost`; the classic script sets `uiHost` to its own host when it is Lucida-hosted),
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
- **URL privacy**: well-known sensitive query params (`password`, `token`, `key`, `code`, `email`, ... see the quickstart) are always masked as `<masked>` in every URL sent and in replay; `urlPrivacy: {maskParams, maskCampaignParams, stripHash}` adds to that.
- **Delivery**: `assetHost` (default: the host `lucida.js` was loaded from) + `modules: ["replay", ...]` (classic script only) load versioned modules from
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

## Agent analytics

```ts
const lucida = init("lc_pk_...", { ai: { captureText: false } });
const convo = lucida.ai.startConversation({ agentName: "support-bot", agentVersion: "3", traceId, topic: "billing" });
convo.message("user", question);
convo.message("assistant", answer);
convo.feedback({ kind: "thumbs", value: -1 });
convo.end("resolved");
```

Events: `$ai_conversation_started`, `$ai_message` (role, auto-incremented index, text length; for user
messages a simhash `$ai_text_hash` and a lexicon `$ai_sentiment` so rephrases and frustration show without the
text), `$ai_feedback` (thumbs 1/-1, rating 1..5, comment), `$ai_conversation_ended` and `$ai_outcome`
(`resolved`, `unresolved`, `escalated`, `abandoned`, `error`). Message text and feedback comments are sent only
with `ai: { captureText: true }`, after cards, emails and phone numbers are masked. `traceId` (a W3C trace id) links the
conversation to its trace in Watchtower; tokens, latency, cost and model names are never captured here.
Events use the normal capture path, so consent and opt-out apply.

## Classic script (`lucida.js`)

For plain HTML, tag managers and site builders. Pin a version and check it with Subresource Integrity (the hash of each
release is in `/static/v<version>/manifest.json`; `lucida init --framework html` prints this snippet with it filled in):

```html
<script>
  window.lucidaQueue = window.lucidaQueue || [];
  lucidaQueue.push(["init", "lc_pk_...", { apiHost: "https://<your capture host>", modules: ["consent", "replay"] }]);
</script>
<script async src="https://<your app host>/static/v0.1.5/lucida.js"
        integrity="sha384-HASH_OF_LUCIDA_JS_FROM_MANIFEST_JSON" crossorigin="anonymous"></script>
```

- **`window.lucidaQueue`** is a plain array you create before the script loads. The script drains it in order, then replaces
  `push` so later commands run at once. Commands: `["init", publicKey, config?]` (once; later `init`s are ignored) and
  `[method, ...args]` for any `Client` method (`["capture", "signed_up", {plan: "pro"}]`, `["identify", "u1"]`,
  `["optIn"]`). Commands before `init` wait for it, and for the `modules` it loads. `window.lucida` is the client once `init`
  ran. Types: add `/// <reference types="@lucida-analytics/browser/lucida-global" />` (`lucida-global.d.ts`).
- **`modules`** (init config, names only): `replay`, `heatmaps`, `forms`, `toolbar`, `guides`, `inspector`, `experiments`,
  `early-access`, `consent`. Each loads from `<assetHost>/static/v<this script's version>/<name>.js` before the client
  starts; one that fails to load is skipped. Not loaded in extension mode.
- **`assetHost`, `uiHost`** default to the origin the script was loaded from (set `assetHost` only when the files are hosted
  elsewhere, `uiHost` only when replay links should point elsewhere). `apiHost` is where events go, default `https://capture.lucidace.com`.
- **`modules: ["consent"]`** adds `client.consent.showBanner()` and follows Cookie Munch: once `CookieMunch.hasResponse` it maps
  `statistics` to analytics + replay and `marketing` to marketing, and follows its change events. Use it with `consent: { mode: "opt_in" }`.
- **Integrity**: with a `manifest.json` next to the script (every release publishes one: `{version, files: {"lucida.js":
  "sha384-...", "modules/<name>.js": "sha384-..."}}`), the loader fetches each lazy module and checks it with WebCrypto
  (`SHA-384`) against the manifest before running it. A module that differs, one the manifest does not list, or a page
  without WebCrypto is refused with a `console.warn`, and the client starts without it. With no manifest (an old deploy) modules
  load as before. Lazy chunks a module imports are not hashed separately.
- **Caching**: `/static/v<x.y.z>/*` is `immutable` for a year; `/static/v<major>/*` and `/lucida.js` are cached 5 minutes; a 404 is never cached.
- **Storage**: every cookie and storage key is listed in `storage.json` (shipped in this package).

## Interventions

`client.onIntervention((i) => ...)` receives the in-session interventions fired for the current person (`{id, intervention_id, name, event, payload, fired_at}`, each once). The first listener opens `GET /v1/interventions/stream` (after analytics consent); it resumes after the last fire on reconnect and follows `identify` / `reset`. Returns an unsubscribe function. See `docs/guides/interventions.md`.

## Develop

`pnpm test` (jsdom), `pnpm e2e` (builds, then real Chromium via Playwright against a stub
ingest server), `pnpm size` (bundle budgets).

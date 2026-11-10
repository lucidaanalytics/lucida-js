import type { AgentConversation, AgentConversationOptions, Core, ConsentCategory, ConsentMode, ConsentState, ConsentStatus, EarlyAccessService, EvalContext, FlagDefinition, FlagResult, Intervention, Props, Storage, Transport, WireEvent } from "@lucida-analytics/sdk-core";
import type { ConsentUi } from "./consent/options.js";
import type { ReplayConfig, ReplayOwner } from "./replay/config.js";
import type { TriggerGroup } from "./replay/groups.js";
import type { CanvasMaskRule } from "./replay/canvas.js";
import type { BeforeSend, PersonProfiles } from "./policy.js";
import type { RateLimitConfig } from "./ratelimit.js";
import type { UrlPrivacy } from "./url-privacy.js";
import type { AutocaptureConfig, DeliveryConfig, StorageConfig } from "./config-types.js";
import type { RecommendationOptions, Recommendations, RecsService } from "./recs/index.js";

export type { AutocaptureConfig, DeliveryConfig, FrustrationConfig, LazyModuleName, Persistence, StorageConfig } from "./config-types.js";

export interface BootstrapConfig {
  distinctId?: string;
  /** distinctId belongs to a signed-in user (identified), not an anonymous visitor. */
  isIdentified?: boolean;
  /** Session id to continue (server-rendered pages). Ignored when a session is already stored. */
  sessionId?: string;
  flags?: Record<string, boolean | string>;
  payloads?: Record<string, unknown>;
}

/** Flag request tuning (the `flags` module). */
export interface FlagOptions {
  /** Abort a /v1/flags request after this long (default 10000). */
  timeoutMs?: number;
  /** Refetch on this interval while the page is visible (0/unset = off). */
  refreshMs?: number;
  /** Evaluate and expose only these flag keys. */
  keys?: string[];
  /** Evaluation-context tags sent with the request for server-side scoping. */
  evaluationContexts?: string[];
  /** Never call /v1/flags: values come from bootstrap, localFlags and `updateFlags()` only. */
  disableRemote?: boolean;
  /**
   * Skip the automatic flag requests (page load, `refreshMs`) while the last response for this visitor is younger than
   * this many ms. `reloadFlags()`, identify/reset/group and property or context changes always fetch. Default off.
   */
  cacheTtlMs?: number;
  /** false: do not add the landing URL's campaign params, `$os`, `$browser` and `$device_type` to flag requests as person properties. Default true. */
  autoProperties?: boolean;
}

/** Per-call capture options. */
export interface CaptureOptions {
  /** Event time (epoch ms, ISO string or Date) instead of now. Invalid values are ignored. */
  timestamp?: number | string | Date;
  /** Flush the queue right after this event. */
  sendInstantly?: boolean;
  /** "beacon" flushes with sendBeacon (survives unload; falls back to fetch keepalive when `disableBeacon`). */
  transport?: "beacon" | "fetch";
}

export interface BrowserConfig extends StorageConfig, DeliveryConfig {
  apiHost?: string;
  /** Lucida app/API host for the toolbar and deep links (`getReplayUrl`) when `apiHost` is a reverse proxy that only forwards capture (default `apiHost`). */
  uiHost?: string;
  /** Toolbar: data attributes preferred when it builds an element selector (default data-lc-id, data-testid, data-test, data-cy, data-qa). */
  toolbar?: { dataAttributes?: string[] };
  autocapture?: boolean | AutocaptureConfig;
  /** 'history' = initial + SPA route changes (path or query; an in-page #anchor is not a new page), 'hash' = history plus hash routes (`$pathname` includes the `#/route` fragment, fires on `hashchange`), true = initial only, false = none. Default 'history'. */
  capturePageview?: "history" | "hash" | boolean | { path?: boolean; search?: boolean; hash?: boolean };
  /** CSS selector(s) of the element that scrolls when the page itself does not (app shells); `$scroll_depth` measures it. First match wins. */
  scrollRoot?: string | string[];
  consent?: {
    mode?: ConsentMode;
    queueBeforeConsent?: boolean;
    respectDnt?: boolean;
    /** Storage key of the stored decision (default `lc_consent`, suffixed per project like every SDK key). */
    storageKey?: string;
    /** Version of your consent text/policy, written to every `$consent_updated` record. Default "1". */
    policyVersion?: string;
    /** Send the consent-log record for a visitor who declines analytics as one anonymous beacon (no id, session, URL or storage). Default false: such a decision is not logged. */
    logBeacon?: boolean;
    /**
     * Cookieless "on reject": after a visitor declines, keep counting pageviews and events anonymously (no storage,
     * no distinct_id, no person properties; the gateway derives its daily cookieless id, so the project needs
     * cookieless mode on). Granting later switches to normal identity. Default false: a decline drops events.
     */
    cookielessOnReject?: boolean;
    /**
     * Geo consent defaults (N-ANA-17): before anything is stored or sent, ask `GET /v1/config` which mode the
     * project's rules give this visitor's country / US state (opt-in, opt-out or cookieless). Events wait in memory
     * meanwhile (at most 3 s; then the local `mode` applies). A stored decision skips the wait. Default false.
     */
    geo?: boolean;
  };
  /** Treat Do Not Track as a consent denial in opt_out mode (default false; falls back to consent.respectDnt). */
  respectDnt?: boolean;
  /** Treat Global Privacy Control (`navigator.globalPrivacyControl`) as opt-out of non-essential storage (default false). */
  respectGpc?: boolean;
  /** Capture ad click ids (gclid, gad_source, gclsrc, dclid, gbraid, wbraid, fbclid, igshid, msclkid, ttclid, li_fat_id, twclid, mc_cid) from landing URLs into `$click_ids` on every event and `$initial_*` / `$last_*` person properties on `$pageview`. Remembered 90 days (`expiryDays`); stored only after consent. false = off. */
  clickIds?: false | { expiryDays?: number };
  /** Hostnames to carry the visitor across with an `_lcid` link param (and accept it from). Match is exact or a subdomain. */
  crossDomains?: string[];
  debug?: boolean;
  /** No events, no storage, no network (tests). */
  disabled?: boolean;
  /** Send nothing from known crawler / headless user agents (default true; the server still classifies anything that gets through). */
  blockBots?: boolean;
  /** Extra user-agent substrings (case-insensitive) treated as bots when `blockBots` is on. */
  blockedUserAgents?: string[];
  /** Guides module: render=false leaves display to the host app. */
  guides?: { render?: boolean; /** Keep progress and dismissals on the server so they follow a person across devices (default true; needs consent and a distinct id). */ syncState?: boolean; /** Preferred guide language (BCP 47); default: person property `locale`, then the browser's. */ locale?: string; /** In a child frame: draw guides in the top window at this exact origin (its SDK must list this frame's origin in `frameOrigins`). */ renderInTop?: string; /** Top window: child-frame origins allowed to forward guides here. */ frameOrigins?: string[] };
  /** Visual-editor / personalization changes (the `experiments` module). antiFlickerMs hides the page until flags load (0 = off). */
  visualChanges?: {
    antiFlickerMs?: number;
    /** Run per-variant custom JS that the project approved (`experiment.custom_code`); default false, so no experiment code runs unless the site opts in. */
    allowCustomJs?: boolean;
  };
  /** Split-URL tests (the `splitUrl` experiments module): see experiments/split-url.ts. */
  splitUrl?: { antiFlickerMs?: number; allowedOrigins?: string[]; navigate?: (url: string) => void };
  /** Product recommendations (the `recommendations` module): the event and property that mark an item view (default `$product_viewed` / `item_id`). */
  recommendations?: { viewEvent?: string; itemIdProperty?: string };
  /** Skip the flags request at init; flags load on reloadFlags(), identify(), group() or reset(). */
  disableFlagsOnFirstLoad?: boolean;
  /** Attach `$feature/<key>` and `$active_feature_flags` to captured events (default true). */
  sendFeatureFlags?: boolean;
  bootstrap?: BootstrapConfig;
  /**
   * Hooks run in order on every event right before it is queued: return the (amended) event, or null to drop it.
   * A hook that throws (or returns a non-event) drops the event. Events from sdk-internal modules go through them too.
   */
  beforeSend?: BeforeSend | BeforeSend[];
  /** Keep this share (0..1) of events, stamping `$sample_rate`. Runs before `beforeSend`. */
  sampleRate?: number;
  /** Property names never sent (event properties, `$set`, `$set_once`). Runs before `beforeSend`. */
  propertyDenylist?: string[];
  /** Mask query parameters (`maskParams`, or all UTM / click-id ones with `maskCampaignParams`) and optionally drop `#fragments` in every page URL sent. Runs first. */
  urlPrivacy?: UrlPrivacy;
  /**
   * "always" (default): normal person processing. "identified_only": events carry `$process_person_profile:false`
   * until identify/alias/group/setPersonProperties. "never": always personless; identify/alias/setPersonProperties no-op.
   */
  personProfiles?: PersonProfiles;
  /** reset() keeps this device's first anonymous id instead of minting a new one. */
  reuseAnonymousId?: boolean;
  /** Client token bucket (off by default): drops events beyond eventsPerSecond (10) with a burst of 100. */
  rateLimit?: RateLimitConfig;
  /** Session rotation limits in ms (defaults 30 min idle, 24 h total). */
  /** Session rotation; unset values follow the project's session definition in the remote config (N-ANA-6). */
  session?: { idleMs?: number; maxMs?: number; newOnEvents?: string[] };
  /**
   * Hostnames (`api.example.com`, or `.example.com` for the domain and subdomains) whose fetch/XHR requests carry
   * `X-Lucida-Distinct-Id` and `X-Lucida-Session-Id`. Opt-in, consent-gated, never sent to the ingest host.
   */
  tracingHeaders?: string[];
  /** Never use sendBeacon. */
  disableBeacon?: boolean;
  /** Extra headers on ingest requests (adds a CORS preflight to the ingest host). */
  requestHeaders?: Record<string, string>;
  /** Called when an ingest request fails (status 0) or returns an error status. */
  onRequestError?: (e: { url: string; status: number }) => void;
  /** Extra query parameters treated as campaign params (stored as `$<name>` on `$pageview`). */
  customCampaignParams?: string[];
  /** `$pageleave`: true = also without pageview capture, false = never, "if_capture_pageview" (default) = with pageviews. */
  capturePageleave?: boolean | "if_capture_pageview";
  /** Origin for /v1/flags when flags are proxied separately. Default apiHost. */
  flagsApiHost?: string;
  flagOptions?: FlagOptions;
  flushAt?: number;
  flushIntervalMs?: number;
  /** Persist undeliverable batches in localStorage and replay them when online (default true). */
  offlineQueue?: boolean;
  /** Session replay (the `replay` module). */
  replay?: ReplayConfig;
  /** Who records the DOM when Watchtower is also on the page. Unset: Lucida records, unless a Watchtower SDK on the page already announces it is recording; then Lucida yields (and logs a console warning). Set 'lucida' or 'both' to force recording, 'watchtower' to never record. */
  replayOwner?: ReplayOwner;
  /** Watchtower seam: correlate fetch/XHR with the Lucida session via W3C baggage. */
  watchtower?: { correlate?: boolean; origins?: Array<string | RegExp> };
  /** Heatmap capture options (the `heatmaps` module). `attention` batches visible time per scroll band and element. */
  heatmaps?: { moves?: boolean; moveIntervalMs?: number; attention?: boolean };
  /** Subscribe to GET /v1/flags/stream (public key; change notices only) and refetch flags on a notice. `pollMs` = fallback poll while the stream is down (default 60s, 0 = off). Default off. */
  flagStream?: boolean | { pollMs?: number };
  /** Flag definitions bootstrapped from the server; evaluated in the browser with the sdk-core evaluator. */
  localFlags?: FlagDefinition[];
  /** Person/group/device properties the local evaluator may use (it knows nothing else about the user). */
  localFlagsContext?: Partial<EvalContext>;
  /** Agent analytics (`client.ai`). `captureText` sends message text and feedback comments, redacted (cards, emails, phones); default false (length, hash and sentiment only). */
  ai?: { captureText?: boolean };
  /** Test/advanced overrides. */
  transport?: Transport;
  fetch?: typeof fetch;
}

/** `client.ai`: agent / chatbot conversation analytics (product side; LLM traces stay in Watchtower). */
export interface AgentAnalytics {
  /** Emits `$ai_conversation_started` and returns the handle for `message`, `feedback`, `end` and `outcome`. */
  startConversation(opts?: AgentConversationOptions): AgentConversation;
}

export interface RemoteConfig {
  autocapture?: boolean;
  /** Mirrors go/gateway ProjectConfig. */
  session_recording?: boolean;
  replay_sample_rate?: number;
  mask_all_inputs?: boolean;
  heatmaps?: boolean;
  /** Replay privacy policy (settings.sdk): selectors masked / blocked; URL patterns (substring, `*` wildcard) not recorded; pages where a session start is never recorded. */
  replay_mask_selectors?: string[];
  /** Mask all replay text in the browser (LC-EXP-40); only tightens. */
  replay_mask_all_text?: boolean;
  replay_block_selectors?: string[];
  replay_url_blocklist?: string[];
  replay_never_record?: string[];
  /** Recording rules (settings.sdk); see replay/groups.ts. */
  replay_trigger_groups?: TriggerGroup[];
  replay_min_duration_ms?: number;
  replay_min_duration_mode?: "buffer" | "session";
  /** Project toggle that turns canvas capture on with default fps/quality (a local `captureCanvas: false` refuses it). */
  replay_capture_canvas?: boolean;
  /** Canvas mask rules (LC-EXP-59): canvases matching `selector` get `regions` (or the whole canvas) painted over; only adds masking. */
  replay_canvas_mask?: CanvasMaskRule[];
  /** Optional extended replay settings (same names as ReplayConfig). */
  replay?: Partial<ReplayConfig>;
  /** Project session definition (N-ANA-6): idle minutes, longest session in minutes, events that start a session. */
  session_idle_minutes?: number;
  session_max_minutes?: number;
  session_new_on_events?: string[];
  /** Geo consent default resolved for this visitor (N-ANA-17), and the location it was resolved from. */
  consent_default?: "opt_in" | "opt_out" | "cookieless";
  consent_country?: string;
  consent_region?: string;
  [k: string]: unknown;
}

export type FlagValue = boolean | string;

/** Flags module surface the client delegates to. */
export interface FlagsService {
  get(key: string): FlagValue | undefined;
  payload(key: string): unknown;
  /** Value, variant, payload and reason of one flag; records the exposure unless `sendExposure` is false. */
  result(key: string, opts?: { sendExposure?: boolean }): FlagResult;
  /** A layer parameter (LC-EXT-36) from the layer experiment this person is in (records its exposure); undefined when in none. */
  layerParam(layer: string, param: string): unknown;
  onChange(cb: (flags: Record<string, FlagValue>) => void): () => void;
  reload(): Promise<void>;
  /** Every known flag value (overrides applied) without recording exposures. */
  all(): Record<string, FlagValue>;
  /** Local overrides that win over server values; false clears them. */
  override(map: Record<string, FlagValue> | false, opts?: { persist?: boolean }): void;
  setPersonProperties(props: Props, reload?: boolean): void;
  resetPersonProperties(): void;
  setGroupProperties(props: Record<string, Props>, reload?: boolean): void;
  resetGroupProperties(): void;
  /** Sets the context of one kind for flag evaluation (kept in memory only; sent with the next flags request). */
  setContext(kind: FlagContextKind, key: string, properties?: Props): void;
  clearContext(kind: FlagContextKind): void;
  /** Push flags evaluated elsewhere (your backend). merge=false replaces the current set. */
  update(flags: Record<string, FlagValue>, payloads?: Record<string, unknown>, merge?: boolean): void;
}

/** The context kinds flags can target and bucket on (LC-FLG-18). */
export type FlagContextKind = "user" | "device" | "org";

/** A person / group property test (`value` is compared as text). */
export interface PropFilter {
  key: string;
  op: "eq" | "neq" | "contains" | "exists";
  value?: unknown;
  /** group_filters only: the group type (e.g. "org"). */
  group_type?: string;
}

/** Client-side targeting keys for guides (cohort_ids / exclude_cohort_ids are resolved by the gateway). */
export interface TargetConditions {
  url?: string;
  url_match?: "exact" | "contains" | "regex";
  event_trigger?: string;
  flag_key?: string;
  /** With `flag_key`: only people served this variant (multivariate flags). */
  flag_variant?: string;
  delay_seconds?: number;
  sample_pct?: number;
  wait_days?: number;
  devices?: Array<"desktop" | "mobile" | "tablet">;
  person_filters?: PropFilter[];
  /** Group (account) attributes, from `group(type, key, props)` calls. */
  group_filters?: PropFilter[];
  /** Guide ids this person must have / must not have seen in this browser. */
  seen_guides?: string[];
  not_seen_guides?: string[];
  /** Window (RFC 3339), weekdays 0=Sunday and local hours [from, to) the guide may show in. */
  schedule?: { start?: string; end?: string; days?: number[]; hours?: { from?: number; to?: number }; timezone?: string };
  /** At most `max_views` shows per rolling `per_days` (omitted: lifetime). Lifts the default show-once. */
  frequency?: { max_views?: number; per_days?: number };
  /** Share of eligible people held back as the control group (`$guide_holdout`). */
  holdout_pct?: number;
  /** `variant`: each A/B variant holds back its own control group (default: pooled across the group). */
  holdout_scope?: "group" | "variant";
  /** Guides sharing a group are A/B variants: one is picked per person, by `ab_weight`. */
  ab_group?: string;
  ab_weight?: number;
  goal?: { event: string; window_days?: number };
  /** Project-wide exclusions (served by the gateway): never on a URL matching any glob (`*`); a pattern starting with `/` matches the path. */
  exclude_url_patterns?: string[];
}

/** Announcements: published banner guides. */
export interface GuidesService {
  /** Open the changelog panel listing announcement (banner) guides. Returns the entry count (0 = nothing shown). */
  showChangelog(): number;
  /**
   * Show a published guide now (manual / API trigger), skipping its targeting but never consent, a guide already on
   * screen, or the one-at-a-time rule. False when the guide is unknown (not published to this person) or blocked.
   */
  show(id: string): boolean;
  /** Forget that this browser saw / dismissed / progressed through the guide, so its targeting can show it again. */
  reset(id: string): void;
}

export interface GuideButton {
  label: string;
  action: "next" | "back" | "dismiss" | "link" | "event" | "start_tour" | "snooze";
  url?: string;
  /** With `snooze`: hide the guide and show it again after this many hours (1..720). */
  snooze_hours?: number;
  event?: string;
  /** With `next`: jump to a LATER step id, or "end". */
  goto?: string;
}

export interface GuideStep {
  id: string;
  title?: string;
  body?: string;
  selector?: string;
  /** Tried in order when `selector` matches nothing (e.g. a stable data attribute, then a class path). */
  fallback_selectors?: string[];
  /** Tooltip / tour: wait up to this long (ms, default 3000, max 15000) for the target to appear before showing the step unanchored. */
  wait_ms?: number;
  /** How the step moves on: its buttons (default), a click on the target, or a `change` of the target field (value never read). */
  advance?: "button" | "click" | "input";
  /** Close the step (as dismissed, reason `auto_close`) after this many seconds (1..600). */
  auto_close_s?: number;
  /** Last step: a short confetti burst on completion (skipped under prefers-reduced-motion). */
  confetti?: boolean;
  /** Act on the page when the step shows. Never on password / masked / card fields; values are never read. */
  automation?: GuideAutomation;
  /** Mobile anchor (accessibility identifier / view tag / Flutter key / RN testID); the web ignores it. */
  native_id?: string;
  /** `form_validation` guides: the field and its format rules. */
  validation?: { selector: string; rules: GuideRule[] };
  placement?: "top" | "bottom" | "left" | "right";
  /** Page (URL substring) this step lives on; a tour waits for it across navigations. */
  url?: string;
  buttons?: GuideButton[];
  /** First matching rule wins when Next is pressed on a step with no `goto`. Keys are person properties. */
  branch?: Array<{ key: string; op: PropFilter["op"] | "element_present" | "element_absent" | "flag_on" | "flag_off"; value?: unknown; goto: string }>;
  /** Checklist item: completes itself when this event is captured (all `props` equal). */
  complete_on?: { event: string; props?: Record<string, string | number | boolean> };
  /** Per-locale text; `buttons` are labels by position. */
  i18n?: Record<string, { title?: string; body?: string; buttons?: string[] }>;
  /** Rich media under the text (https only; embeds are sandboxed iframes of known video hosts). */
  media?: GuideMedia[];
  /** Resource-center module this item renders: other guides, announcements, or help-doc search. */
  module?: "guides" | "announcements" | "search";
  /** `guides` module: which guides to list (default: every tour, checklist and modal). */
  guide_ids?: string[];
  /** `search` module: help-doc search URL with `{q}`, opened in a new tab. */
  search_url?: string;
}

export interface GuideAutomation {
  action: "click" | "focus" | "fill";
  selector: string;
  /** `fill` only: a builder-set constant. */
  value?: string;
}

/** One format rule of a `form_validation` step (checked in the page; the value never leaves it). */
export interface GuideRule {
  type: "required" | "email" | "url" | "phone" | "regex" | "min_length" | "max_length" | "number";
  value?: string | number;
  message: string;
}

/** Colors (#hex), radius and font applied to the rendered guide. */
export interface GuideTokens {
  background?: string;
  text?: string;
  accent?: string;
  radius?: number;
  /** CSS font-family list (letters, digits, spaces, commas, quotes, hyphens). */
  font?: string;
  shadow?: "none" | "sm" | "lg";
  button_radius?: number;
  /** Secondary (non-first) buttons. */
  secondary?: string;
  secondary_text?: string;
}

export interface GuideMedia {
  type: "image" | "video" | "embed";
  url: string;
  alt?: string;
}

export type GuideKind = "tooltip" | "modal" | "banner" | "tour" | "checklist" | "resource_center" | "announcement" | "hotspot" | "beacon" | "badge" | "launcher" | "slideout" | "inline" | "carousel" | "form_validation";

/** Shape of go/gateway GET /v1/guides; conditions are the client targeting keys. */
export interface Guide {
  id: string;
  name: string;
  kind: GuideKind;
  steps: GuideStep[];
  conditions: TargetConditions;
  appearance?: {
    i18n?: Record<string, { name?: string }>;
    launcher_label?: string;
    tokens?: GuideTokens;
    /** Dark variant, used when `theme_mode` is dark, or auto and the visitor prefers dark. */
    dark?: { tokens?: GuideTokens };
    theme_mode?: "auto" | "light" | "dark";
    /** Theme font (resolved by the gateway from `theme_id`); `tokens.font` wins. */
    font_family?: string;
    /** Dim the page behind the guide (default: modal only). */
    overlay?: boolean;
    /** Close (as dismissed) on a click outside the guide (default: modal only). */
    dismiss_on_outside_click?: boolean;
    /** Slideout edge. */
    side?: "left" | "right";
    [k: string]: unknown;
  };
  version?: number;
  /** When the guide first went live (announcements list newest first). */
  published_at?: string;
  /** A draft served to one of its QA users (gateway): targeting is skipped, events carry `$guide_preview`. */
  preview?: boolean;
  /** This person is in the guide's holdout (decided by the gateway); the guide carries no steps. */
  held_out?: boolean;
  /** A workflow queued this guide for this person (gateway): it shows on the next eligible page view, skipping delay, sampling and wait_days. */
  queued?: boolean;
}

/** What a manual `replay.start()` may bypass (default: sampling only). */
export interface ReplayStartOverride {
  sampling?: boolean;
  url_trigger?: boolean;
  event_trigger?: boolean;
  linked_flag?: boolean;
}

/** Recording control (the `replay` module registers it; every call is a no-op without the module). */
export interface ReplayControl {
  /**
   * Start now. No argument bypasses sampling only; `true` also bypasses every trigger; an object picks what to bypass.
   * Never bypasses consent, replayOwner, the project kill-switch or never-record pages. Resolves once the attempt settled.
   */
  start(override?: true | ReplayStartOverride): Promise<void>;
  /** Stop and discard unsent data; auto-start stays off until start(). */
  stop(): void;
  pause(): void;
  resume(): void;
  /** Emits `$replay_tag` { name, session_id } so the replay timeline can be searched. */
  tag(name: string): void;
  isRecording(): boolean;
}

/** What modules receive: the shared core plus platform helpers. */
export interface Host {
  core: Core;
  client: Client;
  config: BrowserConfig & { apiHost: string };
  apiKey: string;
  log: (...a: unknown[]) => void;
  fetch: typeof fetch;
  /** Consent-gated store for the flag cache and persisted overrides (`flagPersistence`, else the core storage). */
  flagStorage: Storage;
  /** Runs on pagehide, before the final beacon flush. */
  onUnload(fn: () => void): void;
  /** Remote config; in opt_in mode resolves only after consent (no network before). */
  loadConfig(): Promise<RemoteConfig | null>;
  /** Run fn now if analytics consent is held, else when granted. */
  whenConsented(fn: () => void): void;
  /** Observe every captured event (after the consent gate). */
  onCapture(fn: (e: WireEvent) => void): void;
  /** Extra props for every event, contributed by modules (replay diagnostics). Read at event time with the event's session id. */
  eventExtras: Array<(sessionId: string) => Props>;
  /** Extra props for click events, contributed by modules (heatmaps). Read at event time. */
  clickExtras: Array<(ev: MouseEvent, el: Element) => Props>;
  /** Person properties modules add to flag requests and local evaluation (early-access enrolment). */
  flagPersonProps: Array<() => Props>;
  /** Set by autocapture when it already captures interactive clicks (heatmaps then adds only the rest). */
  autocaptureClicks?: boolean;
  /** A module registers the flags service here. */
  flags?: FlagsService;
  /** The earlyAccess module registers its service here. */
  earlyAccess?: EarlyAccessService;
  /** The guides module registers its service here. */
  guides?: GuidesService;
  /** The consentBanner module registers the lazy banner here. */
  consentUi?: ConsentUi;
  /** The replay module registers its control here. */
  replay?: ReplayControl;
  /** The toolbar module registers its manual loader here. */
  toolbar?: { load(token: string): Promise<boolean> };
  /** The visualChanges module registers manual experiment activation here. */
  experiments?: { activate(flagKey: string): void };
  /** The recommendations module registers its service here. */
  recs?: RecsService;
}

/** A module is a function; it may return a teardown. Unused modules are tree-shaken. */
export type Module = (host: Host) => void | (() => void);

export interface Client {
  readonly distinctId: string;
  capture(event: string, props?: Props, options?: CaptureOptions): void;
  identify(id: string, set?: Props, setOnce?: Props): void;
  alias(alias: string, original?: string): void;
  /** Forget the user. `resetDeviceId` also mints a new stable device id (flag device stickiness). */
  reset(resetDeviceId?: boolean): void;
  /** `$set` / `$set_once` on the current person (no-op with personProfiles "never"; turns a personless visitor into a person). */
  setPersonProperties(set?: Props, setOnce?: Props): void;
  unsetPersonProperties(keys: string[]): void;
  /**
   * personProfiles "identified_only": start processing a person for this visitor without identify() (the
   * `$set_once` initial values kept while personless are sent along). No-op in "always" and "never".
   */
  createPersonProfile(): void;
  /**
   * Change options at runtime. Object options (autocapture, rateLimit, ...) merge one level deep. Takes effect at once
   * for what is read per event: debug, autocapture options, beforeSend, sampleRate, propertyDenylist, rateLimit,
   * persistedProperties, sendFeatureFlags, customCampaignParams, requestHeaders. Start-up options (apiHost,
   * persistence, personProfiles, modules) keep their initial value.
   */
  setConfig(partial: Partial<BrowserConfig>): void;
  getSessionId(): string;
  /** Called with the session id now and on every rotation; returns the unsubscribe. */
  onSessionId(cb: (sessionId: string) => void): () => void;
  /** A registered super property (`register`). */
  getProperty(key: string): unknown;
  /** True while analytics capture is not allowed (opted out, or an opt_in project not yet opted in). */
  hasOptedOut(): boolean;
  /** Link to this session's replay in the Lucida app (uiHost, else apiHost). */
  getReplayUrl(o?: { withTimestamp?: boolean; timestampLookBackSeconds?: number }): string;
  /** Flip debug logging at runtime (also enabled by `?__lucida_debug=1`). */
  debug(on?: boolean): void;
  /** `$feature_view`: this person was shown the feature behind `flagKey`; marks the person `$feature_view/<key>`. */
  featureView(flagKey: string, props?: Props): void;
  /** `$feature_interaction`: this person used the feature behind `flagKey`; marks the person `$feature_interaction/<key>`. */
  featureInteraction(flagKey: string, props?: Props): void;
  /** Push flags evaluated by your own backend; merge=true (default) keeps the rest. */
  updateFlags(flags: Record<string, FlagValue>, payloads?: Record<string, unknown>, o?: { merge?: boolean }): void;
  register(props: Props): void;
  registerOnce(props: Props): void;
  unregister(key: string): void;
  group(type: string, key: string, props?: Props): void;
  /** Grant consent. Default `["analytics", "replay"]`; marketing is granted only when named (`optIn(["analytics", "replay", "marketing"])`). */
  optIn(categories?: ConsentCategory[]): void;
  optOut(): void;
  /** Tag every event from this browser `$internal: true` (staff / test traffic). Persists after consent; pass false to undo. */
  optOutInternal(on?: boolean): void;
  readonly isInternal: boolean;
  setConsent(update: { analytics?: boolean; replay?: boolean; marketing?: boolean }): void;
  /** Current decision per category (the mode's default until the visitor chose). */
  getConsent(): ConsentState;
  /** `pending` until the visitor made an explicit choice, then `granted` or `denied` (default category analytics). */
  getConsentStatus(category?: ConsentCategory): ConsentStatus;
  /** The explicit analytics decision: "pending" until the visitor answers (show your banner then). */
  consentStatus(): ConsentStatus;
  getFlag(key: string): FlagValue | undefined;
  getFlagPayload(key: string): unknown;
  /** Value, variant, payload and reason (evaluator/server reason, or `override`, `preview`, `bootstrap`, `cached`, `pushed`, `not_found`) in one read. */
  getFlagResult(key: string, opts?: { sendExposure?: boolean }): FlagResult;
  isFeatureEnabled(key: string): boolean;
  /**
   * A parameter of an experiment layer (LC-EXT-36): the value set by whichever experiment of the layer this
   * person is allocated to (their exposure is recorded), else `fallback` (outside every experiment, or no flags module).
   */
  getLayerParam<T = unknown>(layer: string, param: string, fallback: T): T;
  onFlags(cb: (flags: Record<string, FlagValue>) => void): () => void;
  /** In-session interventions (N-ANA-2) fired for this person: opens GET /v1/interventions/stream on the first listener (after analytics consent). Returns unsubscribe. */
  onIntervention(cb: (i: Intervention) => void): () => void;
  reloadFlags(): Promise<void>;
  /** Every known flag value, without recording exposures. */
  getAllFlags(): Record<string, FlagValue>;
  /** Force flag values in this browser (QA, tests); `false` clears. persist keeps them across reloads (after consent). */
  overrideFlags(map: Record<string, FlagValue> | false, opts?: { persist?: boolean }): void;
  /** Extra person properties for flag targeting only (additive); reloads flags unless reload=false. */
  setPersonPropertiesForFlags(props: Props, reload?: boolean): void;
  resetPersonPropertiesForFlags(): void;
  /** Extra group properties for flag targeting, by group type. */
  setGroupPropertiesForFlags(props: Record<string, Props>, reload?: boolean): void;
  resetGroupPropertiesForFlags(): void;
  /**
   * Describes the user, device or organisation to flag targeting (`context` filters and `context:<kind>` stickiness).
   * Held in memory only, never stored or captured as an event; it is sent to /v1/flags once analytics consent allows
   * the flags request, and cleared by reset(). Needs the `flags` module (no-op otherwise).
   */
  setContext(kind: FlagContextKind, key: string, properties?: Props): void;
  clearContext(kind: FlagContextKind): void;
  /** Agent analytics: `$ai_*` conversation events through the normal capture path (consent, opt-out, beforeSend apply). */
  readonly ai: AgentAnalytics;
  /** Early-access opt-in (no-ops until the `earlyAccess` module is installed). */
  readonly earlyAccess: EarlyAccessService;
  /** Changelog widget (no-ops until the `guides` module is installed). */
  readonly guides: GuidesService;
  readonly replay: ReplayControl;
  /** First-party consent banner (no-ops until the `consentBanner` module from "@lucida-analytics/browser/consent" is installed). */
  readonly consent: ConsentUi;
  /**
   * Start the toolbar from a launch token you carried yourself (frameworks that rewrite the URL before the SDK reads
   * `?__lc_toolbar=`). Pass the token or the `{token}` object; resolves false when rejected or the `toolbar` module is absent.
   */
  loadToolbar(params: string | { token: string }): Promise<boolean>;
  /**
   * Activate a web experiment whose `lc_trigger` waits (SPAs: call it when the view the experiment targets renders);
   * also re-applies an active experiment's changes after a re-render. Needs the `visualChanges` module.
   */
  activateExperiment(flagKey: string): void;
  /** Recommended items for a placement (empty without the `recommendations` module or on any failure). */
  recommendations(placement: string, opts?: RecommendationOptions): Promise<Recommendations>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

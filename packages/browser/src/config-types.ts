import type { CookieOptions } from "./storage.js";

/**
 * Where SDK state lives. "cookie" (default), "localStorage", "sessionStorage" (gone when the tab closes),
 * "localStorage+cookie" (identity in a cookie and localStorage, everything else in localStorage), "memory"
 * (this page only) and "none" (cookie-free: no storage writes at all, no distinct_id until identify() so the
 * gateway derives its daily cookieless id, and no offline queue).
 */
export type Persistence = "cookie" | "localStorage" | "sessionStorage" | "localStorage+cookie" | "memory" | "none";

/** Modules the classic script (`lucida.js`) can load from `assetHost` (see docs/guides/sdk-pinning.md). */
export type LazyModuleName = "replay" | "heatmaps" | "forms" | "toolbar" | "guides" | "inspector" | "experiments" | "early-access" | "consent";

export interface StorageConfig {
  persistence?: Persistence;
  /** Cookie attributes for "cookie" and "localStorage+cookie". */
  cookie?: CookieOptions;
  /**
   * "always" is `persistence: "none"`. "on_reject" is `consent.cookielessOnReject`: after a decline keep counting
   * anonymously, with nothing stored. Both need cookieless mode on in the project.
   */
  cookieless?: "always" | "on_reject";
  /** Only these super properties (`register` / `registerOnce`) are persisted; the rest last for this page. Default: all. */
  persistedProperties?: string[];
  /** Coalesce storage writes for this long (ms); reads see them at once, page hide writes them out. Default 0 (write through). */
  storageWriteDelayMs?: number;
  /** Separate store for the flag cache and persisted flag overrides (e.g. keep big payloads out of cookies). Default: `persistence`. */
  flagPersistence?: Persistence;
  /** Store for the consent decision itself (e.g. "cookie" so the server can read it). Default: `persistence`. */
  consentPersistence?: Persistence;
}

export interface DeliveryConfig {
  /** Origin that serves the SDK's versioned static files (`/static/v<version>/...`). Default `apiHost`. */
  assetHost?: string;
  /** Classic script only: modules to load from `assetHost` before the client starts. Refused in extension mode. */
  modules?: LazyModuleName[];
  /** Rewrite the path of every request to `apiHost` / `flagsApiHost` (e.g. `/v1/batch` -> `/a/e`) for proxies that rename routes. */
  rewritePath?: (path: string) => string;
  /** CSP nonce put on every `<style>` the SDK injects (guides, experiment anti-flicker veil). */
  nonce?: string;
  /**
   * Browser-extension (Manifest V3) mode: no cookies (localStorage instead), no remote code (`modules` refused).
   * Default: on when the page runs on a `chrome-extension:`, `moz-extension:` or `safari-web-extension:` URL.
   */
  extension?: boolean;
}

export interface AutocaptureConfig {
  /** Capture element text (default true). Text of form controls is never captured. */
  captureText?: boolean;
  /** Only capture events whose target is inside one of these selectors. */
  allowSelectors?: string[];
  /** Never capture events inside these selectors. */
  denySelectors?: string[];
  /** Only capture on pages whose URL matches one of these. */
  urlAllowlist?: Array<string | RegExp>;
  /** Autocapture is off on pages whose URL matches one of these (substring or RegExp); wins over `urlAllowlist`. */
  urlIgnorelist?: Array<string | RegExp>;
  /** Default: click, change, submit. */
  events?: Array<"click" | "change" | "submit">;
  /** `$autocapture` change events for edited `contenteditable` regions: element chain only, never the content (default true). */
  contentEditable?: boolean;
  /** `$copy_autocapture` on copy / cut with `$copy_type` (default false). */
  copyCut?: boolean;
  /** With `copyCut`: also send the selected text as `$selected_content`, digit runs masked and cut to 255 chars (default false). */
  captureCopiedText?: boolean;
  /** `$outbound_click` on links to other hosts (default true). */
  outboundLinks?: boolean;
  /** `$file_download` on download links: true = built-in extension list, string[] = your list, false = off (default true). */
  fileDownloads?: boolean | string[];
  /** `$site_search` when the URL carries a search param: true = q/s/search/query, `{params}` = yours, false = off (default true). */
  siteSearch?: boolean | { params?: string[] };
  /** `$content_impression` / `$content_interaction` for elements marked `data-lc-content` (default true; nothing is sent without the attribute). */
  contentBlocks?: boolean;
  /** `$media_play` / `$media_progress` (25, 50, 75%) / `$media_complete` for `<video>` and `<audio>` (default true). */
  media?: boolean;
  /** Only capture events whose target is inside one of these tags (e.g. ["a", "button"]). */
  elementAllowlist?: string[];
  /** Attribute names kept out of `$elements` (exact, or a trailing `*` prefix such as `data-*`; "href", "id" and "class" work too). */
  attributeIgnore?: string[];
  /** Replace every attribute value in `$elements` (id, href and kept attributes) with `***`, except `attributeAllowlist`. Default false. */
  maskAllAttributes?: boolean;
  /** With `maskAllAttributes`: names whose values stay readable (same matching as `attributeIgnore`). */
  attributeAllowlist?: string[];
  /** Rage-click hint thresholds; false = never add `$rageclick`. Defaults: 3 clicks within 1000 ms and 30 px. */
  rageClicks?: false | FrustrationConfig;
  /** Dead-click hint (`$deadclick_hint`): waitMs of DOM silence after a click on a non-interactive element (default 700). false = off. */
  deadClicks?: false | { waitMs?: number; ignoreSelectors?: string[] };
}

export interface FrustrationConfig {
  count?: number;
  radiusPx?: number;
  windowMs?: number;
  /** Clicks inside these selectors never count (`.lc-no-rageclick` and `[data-lc-no-rageclick]` always opt out). */
  ignoreSelectors?: string[];
  /** Do not count clicks while text is selected (default true). */
  ignoreTextSelection?: boolean;
  /**
   * Repeated clicks on steppers are intended, not rage: number inputs, +/- and arrow buttons, quantity and carousel
   * controls (default true). `stepperSelectors` adds your own.
   */
  suppressSteppers?: boolean;
  stepperSelectors?: string[];
}

import type { EvalContext, FlagDefinition, FlagResult, FlagValue, Intervention, Props, Transport } from "@lucida-analytics/sdk-core";
import type { AppStateLike, AsyncStorageLike, QueueCipher } from "./adapters.js";
import type { Autocapture, AutocaptureConfig } from "./autocapture.js";
import type { GuidesService } from "./guides.js";
import type { BeforeSend, PersonProfiles } from "./policy.js";
import type { ReplayConfig } from "./replay.js";

export type { FlagValue, FlagResult, Intervention };
export type { BeforeSend, PersonProfiles };

/** Wireframe replay control; no-ops unless `replay.enabled`. Consent (analytics + replay) is always required. */
export interface ReplayControl {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  /** Emits `$replay_tag` { name, session_id }. */
  tag(name: string): void;
  isRecording(): boolean;
  /** A tap at screen point (x, y) for the replay touch overlay; see `<LucidaTouchCapture>`. Ignored unless recording with `replay.captureTouches`. */
  tap(x: number, y: number): void;
  /** P-M46: a swipe passed the touch slop (`<LucidaTouchCapture>` calls this). */
  swipeBegan(): void;
  /** P-M46: the swipe ended, `dx`/`dy` = end - start in points; a 48 pt swipe that changed nothing becomes `$dead_swipe`. */
  swipeEnded(dx: number, dy: number): void;
}

/** Identity and flag values known before the first network response (server-rendered, or from a previous launch). */
export interface Bootstrap {
  distinctId?: string;
  /** Treat `distinctId` as an identified user (no anonymous merge on the first identify). */
  isIdentified?: boolean;
  flags?: Record<string, FlagValue>;
  payloads?: Record<string, unknown>;
}

export interface FlagOptions {
  bootstrap?: Bootstrap | undefined;
  /** Emit `$feature_flag_called` / `$exposure` when a flag is read. Default true. */
  sendFeatureFlagEvent?: boolean;
  /** false: no flag request at launch or on identity changes until `reloadFlags()`. Default true. */
  preload?: boolean;
  /** Environment tags sent with the flag request; the server returns only flags whose tags match. */
  evaluationContexts?: string[];
  /**
   * Skip the automatic flag request at launch while the last response for this device and id is younger than this many ms.
   * `reloadFlags()`, identity changes and property changes always fetch. Default off.
   */
  cacheTtlMs?: number;
}

export interface CaptureOptions {
  /** Person properties set with this event (`$set`). */
  set?: Props;
  /** Person properties set once with this event (`$set_once`). */
  setOnce?: Props;
}

export interface NativeClient {
  readonly distinctId: string;
  /** Anonymous id of this device; survives `reset()` with `reuseAnonymousId`. */
  getAnonymousId(): string;
  isOptedOut(): boolean;
  /** Runtime debug toggle. */
  debug(on: boolean): void;
  capture(event: string, props?: Props, opts?: CaptureOptions): void;
  /** Updates person properties without an event of your own (sends a `$set` event). */
  setPersonProperties(set?: Props, setOnce?: Props): void;
  /** `$deep_link_opened` with the url, its query parameters and the referrer. */
  openURL(url: string, referrer?: string): void;
  /** `fetch` that adds `X-Lucida-Distinct-Id` / `X-Lucida-Session-Id` for hosts in `tracingHeaders`. */
  readonly fetch: typeof fetch;
  readonly autocapture: Autocapture;
  /** Screen view: `$screen` with `$screen_name`. */
  screen(name: string, props?: Props): void;
  identify(id: string, set?: Props, once?: Props): void;
  alias(alias: string, original?: string): void;
  reset(): void;
  register(p: Props): void;
  registerOnce(p: Props): void;
  unregister(key: string): void;
  group(type: string, key: string, props?: Props): void;
  optIn(): void;
  optOut(): void;
  getFlag(key: string): FlagValue | undefined;
  getFlagPayload(key: string): unknown;
  /** Value, variant, payload and reason (evaluator/server reason, or `override`, `bootstrap`, `cached`, `pushed`, `not_found`) in one read. */
  getFlagResult(key: string, opts?: { sendExposure?: boolean }): FlagResult;
  isFeatureEnabled(key: string): boolean;
  onFlags(cb: (f: Record<string, FlagValue>) => void): () => void;
  /** In-session interventions (N-ANA-2) fired for this person; polls GET /v1/interventions while a listener is set. Returns unsubscribe. */
  onIntervention(cb: (i: Intervention) => void): () => void;
  reloadFlags(): Promise<void>;
  /** Injects server-evaluated flags (own backend); use with `disableRemoteFeatureFlags`. `merge` keeps existing values. */
  updateFlags(flags: Record<string, FlagValue>, payloads?: Record<string, unknown>, opts?: { merge?: boolean }): void;
  /** Every known flag value, without exposure events. */
  getAllFlags(): Record<string, FlagValue>;
  /** Force values on this device; `false` clears. */
  overrideFlags(map: Record<string, FlagValue> | false): void;
  /** Person / group properties used only to evaluate flags (no `$set` event). `reload` (default true) re-evaluates now. */
  setPersonPropertiesForFlags(props: Props, reload?: boolean): Promise<void>;
  resetPersonPropertiesForFlags(reload?: boolean): Promise<void>;
  setGroupPropertiesForFlags(type: string, props: Props, reload?: boolean): Promise<void>;
  resetGroupPropertiesForFlags(reload?: boolean): Promise<void>;
  readonly replay: ReplayControl;
  /**
   * Controlled exposure (P-L12): sends `value` RSA-OAEP-SHA256 encrypted (natively) with the project key as
   * `$sensitive_capture`, only when `field` (your testID) is listed in the project's exposure fields, the key is present,
   * analytics + replay consent is held and replay is enabled. Only an audited reveal on the server can read it; identical
   * values are sent once per session. Never pass a secure (password) field. Returns whether an event was captured.
   */
  captureSensitive(field: string, value: string): boolean;
  /** In-app guides; inert unless `guides.enabled` and a `<LucidaGuides />` is mounted. */
  readonly guides: GuidesService;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface NativeConfig {
  apiHost?: string;
  /** Inject @react-native-async-storage/async-storage. Omitted: in-memory only. */
  asyncStorage?: AsyncStorageLike;
  /** Inject react-native's AppState for $app_opened / $app_backgrounded and flush on background. */
  appState?: AppStateLike;
  fetch?: typeof fetch;
  transport?: Transport;
  appVersion?: string;
  appBuild?: string;
  /** Send install attribution on the first-open `$app_installed` (default true); needs `installInfo`. */
  installAttribution?: boolean;
  /** Native source: `() => NativeModules.LucidaReplay.installInfo()`. Omitted: `$app_installed` is sent immediately without attribution. */
  installInfo?: () => Promise<import("./install.js").InstallInfo | null>;
  platform?: string;
  osVersion?: string;
  consent?: { mode?: "opt_in" | "opt_out"; queueBeforeConsent?: boolean; storageKey?: string };
  flushAt?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  /** Encrypt the persisted offline queue at rest (Keychain / Keystore backed). */
  queueCipher?: QueueCipher;
  /** Largest batch per request; bigger queues are sent in chunks, also for a custom `transport`. Default: no split. */
  maxBatchSize?: number;
  maxRetries?: number;
  /** Base of the exponential retry delay. Default 1000. */
  retryDelayMs?: number;
/** Abort (or, for a custom `transport`, stop waiting for) a request after this long (0 = never). Default 0. */
  requestTimeoutMs?: number;
  /** `wifi`: flush only while `network.isWifi()`; events wait in the queue otherwise. */
  dataMode?: "any" | "wifi";
  network?: { isWifi(): boolean };
  sessionIdleMs?: number;
  sessionMaxMs?: number;
  /** Ask the server not to geolocate events (`$geoip_disable`). */
  disableGeoip?: boolean;
  /** Ordered hooks run on every event before it is queued; return null to drop. A throwing hook is logged and skipped. */
  beforeSend?: BeforeSend[];
  personProfiles?: PersonProfiles;
  /** Keep the anonymous id across `reset()`. */
  reuseAnonymousId?: boolean;
  flagOptions?: FlagOptions;
  /** Never call POST /v1/flags: use with `flagOptions.bootstrap`, `localFlags` and `updateFlags`. */
  disableRemoteFeatureFlags?: boolean;
  /** Attach `$feature/<key>` and `$active_feature_flags` to events (default true). */
  sendFeatureFlags?: boolean;
  /** Send $app_version, $os and $lib as person properties with flag requests (default true). */
  sendDefaultFlagProps?: boolean;
  autocapture?: AutocaptureConfig;
  /** Own-backend hosts that receive `X-Lucida-*` headers through `client.fetch`. */
  tracingHeaders?: string[];
  disabled?: boolean;
  debug?: boolean;
  /** Definitions for on-device evaluation; flags needing the server (cohorts) still use POST /v1/flags. */
  localFlags?: FlagDefinition[];
  localFlagsContext?: Partial<EvalContext>;
  /** Consume /v1/flags/stream with the public key (change notices only) and refetch on notice; falls back to polling (`pollMs`, default 60s) when the runtime cannot stream fetch bodies. Default off. */
  flagStream?: boolean | { pollMs?: number };
  /** Wireframe session replay through the native module (off unless `enabled`). */
  replay?: ReplayConfig;
  /** In-app guides (LC-ENG-15). Off by default: no `/v1/guides` request until enabled. */
  guides?: { enabled?: boolean };
}

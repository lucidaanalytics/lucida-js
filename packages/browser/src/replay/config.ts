import type { RemoteConfig } from "../types.js";
import type { TriggerGroup } from "./groups.js";
import type { AssetCapture } from "./assets.js";
import type { CanvasMaskRule, CanvasRegion } from "./canvas.js";
import type { MutationThrottle } from "./throttle.js";
import type { SupportWidgets } from "./support.js";
import type { UrlPrivacyRule } from "./urlrules.js";

export type ReplayOwner = "lucida" | "watchtower" | "both";

export type ReplayTrigger =
  | { mode: "always" }
  | { mode: "on_event"; events: string[] }
  | { mode: "on_flag"; flag: string }
  | { mode: "on_url"; pattern: string }
  | { mode: "on_frustration" };

export interface ReplayConfig {
  /** Set false to switch the module off. */
  enabled?: boolean;
  /** 0..1, decided once per session. Default 1. */
  sample_rate?: number;
  /** Sessions shorter than this are never sent. Default 0. */
  min_duration_ms?: number;
  trigger?: ReplayTrigger;
  /** Recording rules (groups OR-ed, each with URL/event/flag conditions, sample rate, min duration). Replace `trigger` and `sample_rate` when non-empty. */
  trigger_groups?: TriggerGroup[];
  /** `buffer` (default, strict): this page's recorded data must reach the minimum. `session`: the session's age counts. */
  min_duration_mode?: "buffer" | "session";
  /** Regex source strings. Empty include = every URL. Exclude always wins. */
  include_urls?: string[];
  exclude_urls?: string[];
  /** Extra CSS selectors blocked (placeholder box) / text-masked, on top of [data-lc-block] / [data-lc-mask]. */
  block_selectors?: string[];
  mask_selectors?: string[];
  /** Default true. Only a local `false` loosens it; remote config can only tighten. */
  mask_all_inputs?: boolean;
  /** Mask every text node and text attribute (LC-EXP-40). Remote `replay_mask_all_text: true` forces it on. */
  mask_all_text?: boolean;
  /** Extra masking on pages matching a URL pattern (P-M16), added to the remote `replay_url_privacy_rules`; only tightens. */
  url_privacy_rules?: UrlPrivacyRule[];
  /** With mask_all_text: CSS selectors whose text stays visible, on top of [data-lc-unmask]. Local config only. */
  unmask_selectors?: string[];
  /** Ring buffer length before a trigger fires. Default 60 000. */
  buffer_ms?: number;
  flush_interval_ms?: number;
  /** Flush a chunk at this many (uncompressed) bytes. Default 256 KB. */
  chunk_bytes?: number;
  owner?: ReplayOwner;
  /** Opt-in canvas/WebGL capture (LC-EXP-23). Off unless set here or by the remote `replay_capture_canvas` toggle; `false` refuses the toggle. Canvases inside [data-lc-block] are never captured. */
  captureCanvas?: CanvasCapture | false;
  /** With mask_all_inputs false: input types that stay masked (password is always masked). */
  maskInputOptions?: Partial<Record<MaskableInput, boolean>>;
  /** Rewrites an input value before it is recorded (runs on inputs the rules mask; returning the text unmasks it). */
  maskInputFn?: (text: string, element: HTMLElement) => string;
  /** Rewrites the text of masked elements (e.g. hide only e-mail addresses). Ignored under mask_all_text. */
  maskTextFn?: (text: string, element: HTMLElement | null) => string;
  /** Rewrites page URLs before they leave the browser (meta events and pageview markers in the recording). */
  maskUrlFn?: (url: string) => string;
  /** Opt-in cross-origin iframe capture (LC-EXP-24). Local config only; both sides must list the other's origin. */
  crossOriginIframes?: CrossOriginIframes;
  /** Canvas areas painted black before a frame is encoded (LC-EXP-59), added to the remote `replay_canvas_mask` rules (which local config cannot remove). */
  canvasMaskRegions?: (canvas: HTMLCanvasElement) => CanvasRegion[];
  /** Per-element attribute-mutation guard (LC-EXP-65). On by default (burst 100, 10/s per element); `false` turns it off. */
  mutationThrottle?: MutationThrottle | false;
  /** Opt-in asset inlining / proxying (LC-EXP-64). Local config only. */
  assets?: AssetCapture;
  /** Opt-in: hand this session's replay link to Intercom / Crisp while recording (LC-EXP-28). Local config only. */
  supportWidgets?: SupportWidgets;
}

export type MaskableInput =
  | "color" | "date" | "datetime-local" | "email" | "month" | "number" | "range" | "search" | "tel" | "text" | "time" | "url" | "week" | "textarea" | "select";

export interface CanvasCapture {
  /** Frames per second sampled per canvas. Default 2, max 15. */
  fps?: number;
  /** 0..1 JPEG quality. Default 0.4. */
  quality?: number;
}
export interface CrossOriginIframes {
  /** Parent page: iframe origins whose events are merged. Iframe: parent origins it may post to. Exact `scheme://host[:port]`. */
  allowedOrigins: string[];
}

/** Server policy URL pattern (substring, `*` wildcard) as a regex source. */
export function patternToRegex(p: string): string {
  // `re:` patterns are regular expressions already (G43)
  if (p.startsWith("re:")) return p.slice(3);
  return p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
}

/** True when the URL matches any server policy pattern. */
export function policyMatches(patterns: string[] | undefined, url: string): boolean {
  // case-insensitive like the server's drop pass; an invalid pattern matches nothing
  return !!patterns?.some((p) => {
    try {
      return new RegExp(patternToRegex(p), "i").test(url);
    } catch {
      return false;
    }
  });
}

type Hooks = "maskInputFn" | "maskTextFn" | "maskUrlFn" | "maskInputOptions" | "canvasMaskRegions";
type Local = "owner" | "enabled" | "captureCanvas" | "crossOriginIframes" | "mutationThrottle" | "assets" | "supportWidgets";
export type ResolvedReplay = Required<Omit<ReplayConfig, Local | Hooks>> &
  { [K in Hooks]?: ReplayConfig[K] | undefined } & {
    canvas: { fps: number; quality: number } | null;
    crossOriginIframes: string[] | null;
    canvasMask: CanvasMaskRule[];
    mutationThrottle: MutationThrottle | null;
    assets: AssetCapture | undefined;
  };

function canvasOf(c: CanvasCapture | false | undefined, remoteOn: boolean): ResolvedReplay["canvas"] {
  if (c === false || (!c && !remoteOn)) return null;
  return { fps: clamp(c ? (c.fps ?? 2) : 2, 1, 15), quality: clamp(c ? (c.quality ?? 0.4) : 0.4, 0.05, 1) };
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export const MAX_CHUNK_BYTES = 10_000_000; // gateway caps the decompressed body at 10 MB

/** Local config wins over remote (`replay` object), which wins over defaults. null = remote disabled recording. */
export function resolveReplay(local: ReplayConfig, remote: RemoteConfig | null): ResolvedReplay | null {
  if (remote?.session_recording === false) return null;
  const r = remote?.replay ?? {};
  const pick = <K extends keyof ReplayConfig & keyof ResolvedReplay>(k: K, d: ResolvedReplay[K]): ResolvedReplay[K] =>
    (local[k] ?? r[k] ?? d) as ResolvedReplay[K];
  const maskSelectors = [...(r.mask_selectors ?? []), ...(remote?.replay_mask_selectors ?? []), ...(local.mask_selectors ?? [])];
  return {
    sample_rate: local.sample_rate ?? r.sample_rate ?? remote?.replay_sample_rate ?? 1,
    min_duration_ms: local.min_duration_ms ?? r.min_duration_ms ?? remote?.replay_min_duration_ms ?? 0,
    min_duration_mode: local.min_duration_mode ?? r.min_duration_mode ?? remote?.replay_min_duration_mode ?? "buffer",
    trigger: pick("trigger", { mode: "always" }),
    trigger_groups: local.trigger_groups ?? r.trigger_groups ?? remote?.replay_trigger_groups ?? [],
    include_urls: pick("include_urls", []),
    exclude_urls: [...pick("exclude_urls", []), ...(remote?.replay_url_blocklist ?? []).map(patternToRegex)],
    block_selectors: [...(r.block_selectors ?? []), ...(remote?.replay_block_selectors ?? []), ...(local.block_selectors ?? [])],
    mask_selectors: maskSelectors,
    mask_all_inputs: local.mask_all_inputs ?? (remote?.mask_all_inputs === true || r.mask_all_inputs !== false),
    // A "*" mask selector (strict/HIPAA) is mask-all-text too; the unmask list cannot beat it (mask selectors win).
    mask_all_text:
      local.mask_all_text === true || remote?.replay_mask_all_text === true || r.mask_all_text === true || maskSelectors.includes("*"),
    unmask_selectors: [...(local.unmask_selectors ?? [])],
    // sanitized by the recorder (urlRules): remote config is untrusted input
    url_privacy_rules: [
      ...(Array.isArray(remote?.replay_url_privacy_rules) ? (remote?.replay_url_privacy_rules as UrlPrivacyRule[]) : []),
      ...(local.url_privacy_rules ?? []),
    ],
    buffer_ms: pick("buffer_ms", 60_000),
    flush_interval_ms: pick("flush_interval_ms", 5000),
    chunk_bytes: Math.min(pick("chunk_bytes", 256 * 1024), MAX_CHUNK_BYTES - 16_384),
    canvas: canvasOf(local.captureCanvas, remote?.replay_capture_canvas === true),
    maskInputOptions: local.maskInputOptions,
    maskInputFn: local.maskInputFn,
    maskTextFn: local.maskTextFn,
    maskUrlFn: local.maskUrlFn,
    crossOriginIframes: local.crossOriginIframes?.allowedOrigins.length ? [...local.crossOriginIframes.allowedOrigins] : null,
    canvasMaskRegions: local.canvasMaskRegions,
    canvasMask: (Array.isArray(remote?.replay_canvas_mask) ? remote.replay_canvas_mask : []).filter((r) => typeof r?.selector === "string"),
    mutationThrottle: local.mutationThrottle === false ? null : { ...local.mutationThrottle },
    assets: local.assets,
  };
}

const test = (list: string[], url: string): boolean =>
  list.some((p) => {
    try {
      return new RegExp(p).test(url);
    } catch {
      return false;
    }
  });

/** Include list (empty = all) minus exclude list. */
export function urlAllowed(url: string, include: string[], exclude: string[]): boolean {
  return !test(exclude, url) && (!include.length || test(include, url));
}

interface WatchtowerGlobal {
  __WATCHTOWER__?: { replayActive?: boolean };
}

/**
 * docs/seam/watchtower.md: one recorder per page. An explicit owner 'lucida' or 'both' records;
 * 'watchtower' never does; unset yields to a Watchtower SDK that announces it is recording
 * (`window.__WATCHTOWER__.replayActive === true`).
 */
export function lucidaRecords(owner: ReplayOwner | undefined): boolean {
  if (owner === "watchtower") return false;
  if (owner) return true;
  return (globalThis as WatchtowerGlobal).__WATCHTOWER__?.replayActive !== true;
}

import { sha256Hex } from "@lucida/sdk-core";
import type { Core } from "@lucida/sdk-core";
import { hitTest } from "./replay-hit.js";

/**
 * Native contract (implemented by ios/LucidaReplay.swift and android/.../LucidaReplayModule.kt, which call the
 * Lucida iOS / Android SDK wireframe encoders): one capture of the current native view hierarchy.
 * Resolves to JSON text `{"width": number, "height": number, "events": [meta (type 4), fullSnapshot (type 2)]}`,
 * or "" when nothing can be captured (no key window / activity). Native code must mask: input values and
 * secure fields never leave the device, other text is starred when `maskText` is true. Views wrapped in
 * `<LucidaMask>` / `<LucidaUnmask>` carry the native markers the encoders already honour. See README "Session replay".
 */
export interface NativeReplayModule {
  captureWireframe(options: {
    screen: string;
    maskText: boolean;
    maskAllTextInputs: boolean;
    maskAllImages: boolean;
    maskSandboxedViews: boolean;
    /** Present only in screenshot mode: the native side draws the window, paints the mask plan and only then encodes JPEG. */
    mode?: "screenshot";
    /** JPEG quality 0..1 (screenshot mode). */
    screenshotQuality?: number;
  }): Promise<string>;
}

export interface ReplayConfig {
  /** Off by default; also requires the `replay` consent category. */
  enabled?: boolean;
  /** The native module (`NativeModules.LucidaReplay`), injected so tests and non-native hosts need no React Native. */
  module: NativeReplayModule;
  /** Seconds-level cadence; a snapshot is only sent when the structure changed. Default 5000. */
  snapshotIntervalMs?: number;
  /** Starred text unless false. Default true. */
  maskText?: boolean;
  /** Text-field values are starred unless false (secure fields are never readable). Default true. */
  maskAllTextInputs?: boolean;
  /** Images carry a mask marker unless false. Default true. */
  maskAllImages?: boolean;
  /** WebViews / maps / platform views are recorded as an empty frame unless false. Default true. */
  maskSandboxedViews?: boolean;
  /** "screenshot" sends masked JPEG frames (masks painted on device before encoding) instead of wireframes. Default "wireframe". */
  mode?: "wireframe" | "screenshot";
  /** JPEG quality 0..1 for screenshot mode. Default 0.4. */
  screenshotQuality?: number;
  /** 0..1, decided once per session. Default 1. */
  sampleRate?: number;
  /** Minimum ms between captures on top of the interval. Default 0. */
  throttleMs?: number;
  /** Hold chunks until the session has been recorded this long; a session that ends sooner (or `stop()`) is never sent. Default 0 (off). */
  minDurationMs?: number;
  /** Fetch `GET /v1/config` and honour the project kill switch, sample rate and minimum duration (tightening only). Default true. */
  useRemoteConfig?: boolean;
  /** Start recording only while this flag is on. */
  linkedFlag?: string;
  /** Only these screens are recorded (empty = all). The deny list wins and pauses recording on a denied screen. */
  screenAllowList?: string[];
  screenDenyList?: string[];
  /** Record taps fed to `client.replay.tap(x, y)` (positions only, never what was typed). Default true. */
  captureTouches?: boolean;
  /** Random source for sampling (tests). */
  random?: () => number;
  /** Largest chunk sent (the gateway accepts 10 MB decompressed). Default 5_000_000. */
  maxEventBytes?: number;
  /** Timer injection for tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

export interface ReplayService {
  start(): void;
  stop(): void;
  /** Manual pause: ticks capture nothing until resume() (the timer keeps running). */
  pause(): void;
  resume(): void;
  /** Timer running, not paused, both consent categories held, sampled in, flag on and screen allowed. */
  isRecording(): boolean;
  /** Screen the next capture is attributed to (also emits a navigation marker on change). */
  setScreen(name: string): void;
  /** A tap at screen point (x, y); ignored without consent, before the first snapshot, while paused or on a gated screen. */
  tap(x: number, y: number): void;
  /** One capture pass (the interval calls this); exposed for tests. */
  tick(): Promise<void>;
}

export interface ReplayDeps {
  core: Core;
  fetch: typeof fetch;
  apiHost: string;
  apiKey: string;
  config: ReplayConfig;
  now?: () => number;
  /** Reads `config.linkedFlag`. */
  isFlagOn?: (key: string) => boolean;
}

type RrEvent = { type: number; timestamp: number; data: Record<string, unknown> };
type Remote = { session_recording?: boolean; replay_sample_rate?: number; replay_min_duration_ms?: number };

/** Structure fingerprint: the full snapshot without timestamps, so identical screens are not re-sent. */
const fingerprint = (events: RrEvent[]): string => sha256Hex(JSON.stringify(events.find((e) => e.type === 2)?.data ?? null));

/** Deny wins; an empty allow list allows every screen. */
export const screenAllowed = (screen: string, allow: readonly string[] = [], deny: readonly string[] = []): boolean =>
  !deny.includes(screen) && (allow.length === 0 || allow.includes(screen));

/** Remote config can only tighten the local settings. */
export const effectiveSampleRate = (local: number, remote: Remote | null): number =>
  remote === null ? local : remote.session_recording === false ? 0 : Math.min(local, remote.replay_sample_rate ?? 1);
export const effectiveMinDurationMs = (local: number, remote: Remote | null): number => Math.max(local, remote?.replay_min_duration_ms ?? 0);

/** Id of the `<body>` node in the native full snapshot: where a tap lands when no sized view contains it. */
function bodyId(events: RrEvent[]): number {
  const find = (n: unknown): number | undefined => {
    const o = n as { tagName?: string; id?: number; childNodes?: unknown[] } | undefined;
    if (!o) return undefined;
    if (o.tagName === "body") return o.id;
    for (const c of o.childNodes ?? []) {
      const r = find(c);
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return find(events.find((e) => e.type === 2)?.data.node) ?? 0;
}

/**
 * Mobile wireframe replay for React Native. The native module encodes the view hierarchy; this side owns what
 * the native SDKs own for themselves: consent gate (analytics + replay), project kill switch / sample rate /
 * minimum duration, linked flag, screen allow/deny list, session/window ids, chunk `seq` that resets when the
 * session rotates, dedupe by structure, and delivery to `POST /v1/replay`.
 */
export function createReplay(d: ReplayDeps): ReplayService {
  const { core, config } = d;
  const now = d.now ?? Date.now;
  let screen = "Unknown";
  let timer: unknown;
  let lastFp: string | null = null;
  let lastScreen: string | null = null;
  let lastSession: string | null = null;
  let seq = 0;
  let paused = false;
  let lastCaptureAt = Number.NEGATIVE_INFINITY;
  let remote: Remote | null = null;
  let remoteLoaded = false;
  let sessionStart = 0;
  let held: RrEvent[][] = [];
  const maxHeld = 20; // shortcut: bounded memory; the oldest held chunks beyond this are dropped
  let touches: RrEvent[] = [];
  let tapTarget = 0;
  let tapTree: unknown; // the last sent snapshot's document: taps are resolved against its native view tree
  let hasSnapshot = false;
  const sampled = new Map<string, boolean>();
  const isSampled = (sid: string): boolean => {
    const rate = effectiveSampleRate(config.sampleRate ?? 1, remote);
    if (rate >= 1) return true;
    if (rate <= 0) return false;
    let v = sampled.get(sid);
    if (v === undefined) {
      v = (config.random ?? Math.random)() < rate;
      sampled.clear(); // one session at a time
      sampled.set(sid, v);
    }
    return v;
  };
  const gateOpen = (): boolean => {
    if (config.linkedFlag && !(d.isFlagOn?.(config.linkedFlag) ?? false)) return false;
    return screenAllowed(screen, config.screenAllowList, config.screenDenyList);
  };
  const consented = (): boolean => core.hasConsent("analytics") && core.hasConsent("replay");

  async function loadRemote(): Promise<void> {
    if (config.useRemoteConfig === false || remoteLoaded) return;
    remoteLoaded = true;
    try {
      const r = await d.fetch(`${d.apiHost}/v1/config?api_key=${encodeURIComponent(d.apiKey)}`);
      if (r.ok) remote = (await r.json()) as Remote;
    } catch {
      /* unreachable config: the local settings stand */
    }
    sampled.clear();
  }

  async function send(events: RrEvent[], sessionId: string, windowId: string): Promise<void> {
    const body = JSON.stringify({ api_key: d.apiKey, session_id: sessionId, window_id: windowId, seq, events });
    if (body.length > (config.maxEventBytes ?? 5_000_000)) return;
    try {
      const r = await d.fetch(`${d.apiHost}/v1/replay`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (r.ok) seq += 1;
      else lastFp = null; // retry as a fresh snapshot next tick
    } catch {
      lastFp = null;
    }
  }

  async function tick(): Promise<void> {
    // Revoking either category drops state so a re-grant starts with a clean snapshot.
    if (!consented()) {
      lastFp = null;
      hasSnapshot = false;
      touches = [];
      held = [];
      return;
    }
    await loadRemote();
    if (paused || !gateOpen()) {
      // Resume (or leave the gated screen) with a clean snapshot; touches on a gated screen are dropped.
      lastFp = null;
      hasSnapshot = false;
      touches = [];
      return;
    }
    if (!isSampled(core.session.touch().sessionId)) return;
    const shots = config.mode === "screenshot";
    // A JPEG per tick is costly: screenshot mode never captures more than once a second (same floor as iOS).
    if (now() - lastCaptureAt < (shots ? Math.max(config.throttleMs ?? 0, 1000) : (config.throttleMs ?? 0))) return;
    lastCaptureAt = now();
    let cap: { events?: RrEvent[] };
    try {
      const raw = await config.module.captureWireframe({
        screen,
        maskText: config.maskText ?? true,
        maskAllTextInputs: config.maskAllTextInputs ?? true,
        maskAllImages: config.maskAllImages ?? true,
        maskSandboxedViews: config.maskSandboxedViews ?? true,
        ...(shots ? { mode: "screenshot" as const, screenshotQuality: Math.min(1, Math.max(0, config.screenshotQuality ?? 0.4)) } : {}),
      });
      if (!raw) return;
      cap = JSON.parse(raw) as { events?: RrEvent[] };
    } catch {
      return; // a failing capture must never affect the app
    }
    const events = cap.events ?? [];
    if (!events.some((e) => e.type === 2)) return;
    const { sessionId, windowId } = core.session.touch();
    const rotated = sessionId !== lastSession;
    if (rotated) {
      seq = 0;
      lastSession = sessionId;
      sessionStart = now();
      held = []; // a session cut short is dropped
    }
    const fp = fingerprint(events);
    const ts = now();
    let out: RrEvent[] = touches.splice(0);
    if (rotated || fp !== lastFp) {
      lastFp = fp;
      const snap = events.map((e) => ({ ...e, timestamp: ts }));
      if (screen !== lastScreen) {
        lastScreen = screen;
        // lc-replay reads this custom event as a URL change (app://<screen>)
        snap.splice(1, 0, { type: 5, timestamp: ts, data: { tag: "navigation", payload: { url: `app://${screen}` } } });
      }
      out = [...out, ...snap];
      tapTarget = bodyId(events);
      tapTree = events.find((e) => e.type === 2)?.data.node;
      hasSnapshot = true;
    }
    if (out.length === 0) return;
    const minMs = effectiveMinDurationMs(config.minDurationMs ?? 0, remote);
    if (minMs > 0 && now() - sessionStart < minMs) {
      held.push(out);
      if (held.length > maxHeld) held.shift();
      return;
    }
    const backlog = held;
    held = [];
    for (const chunk of [...backlog, out]) await send(chunk, sessionId, windowId);
  }

  return {
    start() {
      if (timer !== undefined) return;
      timer = (config.setInterval ?? ((fn, ms) => setInterval(fn, ms)))(() => void tick(), config.snapshotIntervalMs ?? 5000);
    },
    stop() {
      if (timer === undefined) return;
      (config.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>)))(timer);
      timer = undefined;
      held = []; // the session ends before it reached the minimum duration
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    isRecording: () =>
      timer !== undefined && !paused && consented() && isSampled(core.session.touch().sessionId) && gateOpen(),
    setScreen(name) {
      screen = name;
    },
    tap(x, y) {
      if (config.captureTouches === false || !hasSnapshot || paused || !consented() || !gateOpen() || touches.length >= 500) return;
      touches.push({
        type: 3,
        timestamp: now(),
        data: { source: 2, type: 2, id: hitTest(tapTree, x, y, tapTarget), x, y },
      });
    },
    tick,
  };
}

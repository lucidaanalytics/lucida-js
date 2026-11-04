import { sha256Hex } from "@lucida-analytics/sdk-core";
import type { Core, Storage } from "@lucida-analytics/sdk-core";
import { DEAD_SWIPE_MIN_DISTANCE, DEAD_SWIPE_SETTLE_MS, deadSwipeDecision } from "./dead-swipe.js";
import { hitTest } from "./replay-hit.js";
import { compilePatterns, maskSnapshotText, screenMasked } from "./replay-masking.js";
import { createReplaySpool } from "./replay-spool.js";
import { createSensitiveCapture } from "./sensitive.js";
import type { ExposureKey, NativeSensitiveModule } from "./sensitive.js";

/**
 * Native contract (implemented by ios/LucidaReplay.swift and android/.../LucidaReplayModule.kt, which call the
 * Lucida iOS / Android SDK wireframe encoders): one capture of the current native view hierarchy.
 * Resolves to JSON text `{"width": number, "height": number, "events": [meta (type 4), fullSnapshot (type 2)]}`,
 * or "" when nothing can be captured (no key window / activity). Native code must mask: input values and
 * secure fields never leave the device, other text is starred when `maskText` is true. Views wrapped in
 * `<LucidaMask>` / `<LucidaUnmask>` carry the native markers the encoders already honour. See README "Session replay".
 */
export interface NativeReplayModule extends Partial<NativeSensitiveModule> {
  captureWireframe(options: {
    /** P-M17: mask every text, input and image whatever the unmask markers say (present only when true). */
    maskScreen?: boolean;
    /** P-M46: regular expressions starred in shown text; screenshots paint matching views (present only when non-empty). */
    maskTextPatterns?: string[];
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
  /**
   * Disk budget for chunks that wait (min duration, offline, upload backoff); over it the oldest whole session is dropped
   * and `onSpoolDrop` fires. Default 10 MiB. Needs `asyncStorage` to survive a restart.
   */
  spoolBudgetBytes?: number;
  /** A whole session was dropped because the spool exceeded its budget (also logged in debug mode). */
  onSpoolDrop?: (info: { sessionId: string; chunks: number; bytes: number }) => void;
  /** Fetch `GET /v1/config` and honour the project kill switch, sample rate and minimum duration (tightening only). Default true. */
  useRemoteConfig?: boolean;
  /** Start recording only while this flag is on. */
  linkedFlag?: string;
  /** Only these screens are recorded (empty = all). The deny list wins and pauses recording on a denied screen. */
  screenAllowList?: string[];
  screenDenyList?: string[];
  /** Record taps fed to `client.replay.tap(x, y)` (positions only, never what was typed). Default true. */
  captureTouches?: boolean;
  /** P-M17 screen-name patterns (`*` wildcard, case-insensitive, whole name): mask everything there. Union with the project's list. */
  maskScreens?: string[];
  /** P-M46 regular expressions starred in any text replay would show. Union with the project's list; invalid ones are ignored. */
  maskTextPatterns?: string[];
  /** P-M46 `$dead_swipe` for swipes fed by `<LucidaTouchCapture>` that changed nothing. Default true. */
  captureDeadSwipes?: boolean;
  /** How long after a swipe the screen must still look the same (tests). Default 700. */
  deadSwipeSettleMs?: number;
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
  /** Erase every spilled chunk (opt-out, reset). */
  clearSpool(): void;
  /** One capture pass (the interval calls this); exposed for tests. */
  tick(): Promise<void>;
  /** P-M46: a swipe passed the touch slop; its start structure is captured now. */
  swipeBegan(): void;
  /** P-M46: the swipe ended (end - start, points); resolves true when a `$dead_swipe` was captured. */
  swipeEnded(dx: number, dy: number): Promise<boolean>;
  /** P-L12: see `NativeClient.captureSensitive`; true when a `$sensitive_capture` was captured. */
  captureSensitive(field: string, value: string): boolean;
}

export interface ReplayDeps {
  core: Core;
  /** Where waiting chunks are spilled (the client's storage, encrypted with the queue cipher when one is set). */
  storage: Storage;
  fetch: typeof fetch;
  apiHost: string;
  apiKey: string;
  config: ReplayConfig;
  now?: () => number;
  log?: (...a: unknown[]) => void;
  /** Reads `config.linkedFlag`. */
  isFlagOn?: (key: string) => boolean;
}

type RrEvent = { type: number; timestamp: number; data: Record<string, unknown> };
type Remote = {
  session_recording?: boolean;
  replay_sample_rate?: number;
  replay_min_duration_ms?: number;
  replay_mask_screens?: unknown;
  replay_mask_text_patterns?: unknown;
  replay_exposure_fields?: unknown;
  replay_exposure_key?: unknown;
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The P-L12 key when all four parts are strings, else null (the feature is off). */
export function exposureKeyOf(v: unknown): ExposureKey | null {
  const k = v as Partial<Record<keyof ExposureKey, unknown>> | null;
  if (!k || typeof k !== "object") return null;
  const { kid, n, e, pkcs1 } = k;
  return typeof kid === "string" && typeof n === "string" && typeof e === "string" && typeof pkcs1 === "string" ? { kid, n, e, pkcs1 } : null;
}

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
  const spool = createReplaySpool(d.storage, config.spoolBudgetBytes, (sessionId, chunks, bytes) => {
    d.log?.(`replay spool over budget: dropped session ${sessionId} (${chunks} chunks, ${bytes} bytes)`);
    config.onSpoolDrop?.({ sessionId, chunks, bytes });
  });
  let touches: RrEvent[] = [];
  let tapTarget = 0;
  let tapTree: unknown; // the last sent snapshot's document: taps are resolved against its native view tree
  let hasSnapshot = false;
  let patternSources = config.maskTextPatterns ?? [];
  let patterns = compilePatterns(patternSources);
  const sensitive = createSensitiveCapture(config.module);
  let swipeStart: Promise<{ screen: string; fp: string } | null> | null = null;
  let lastDeadSwipeAt: number | undefined;
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
    const fromRemote = strings(remote?.replay_mask_text_patterns).filter((p) => p.length <= 200).slice(0, 20);
    patternSources = [...(config.maskTextPatterns ?? []), ...fromRemote];
    patterns = compilePatterns(patternSources);
  }

  const isScreenMasked = (): boolean => screenMasked(screen, [...(config.maskScreens ?? []), ...strings(remote?.replay_mask_screens)]);
  const touchesRecording = (): boolean => hasSnapshot && !paused && consented() && gateOpen();

  /** Structure of the current screen (always a starred wireframe, also in screenshot mode), or null. */
  async function structure(): Promise<string | null> {
    try {
      const raw = await config.module.captureWireframe({ screen, maskText: true, maskAllTextInputs: true, maskAllImages: true, maskSandboxedViews: true });
      const events = raw ? ((JSON.parse(raw) as { events?: RrEvent[] }).events ?? []) : [];
      return events.some((e) => e.type === 2) ? fingerprint(events) : null;
    } catch {
      return null;
    }
  }

  async function swipeEnded(dx: number, dy: number): Promise<boolean> {
    const pending = swipeStart;
    swipeStart = null;
    if (!pending || Math.hypot(dx, dy) < DEAD_SWIPE_MIN_DISTANCE) return false;
    const start = await pending;
    if (!start) return false;
    await new Promise((r) => setTimeout(r, config.deadSwipeSettleMs ?? DEAD_SWIPE_SETTLE_MS));
    if (!touchesRecording()) return false;
    const fp = await structure();
    if (fp === null) return false;
    const t = now();
    const p = deadSwipeDecision({ screen, startScreen: start.screen, startFingerprint: start.fp, endFingerprint: fp, dx, dy, nowMs: t, lastAt: lastDeadSwipeAt });
    if (!p) return false;
    lastDeadSwipeAt = t;
    core.capture("$dead_swipe", p);
    return true;
  }

  function captureSensitive(field: string, value: string): boolean {
    const key = exposureKeyOf(remote?.replay_exposure_key);
    if (!value || !key || !strings(remote?.replay_exposure_fields).includes(field) || !consented()) return false;
    const p = sensitive.properties(field, value, screen, key, core.session.touch().sessionId);
    if (!p) return false;
    core.capture("$sensitive_capture", p);
    return true;
  }

  function store(events: RrEvent[], sessionId: string, windowId: string, held: boolean): void {
    const body = JSON.stringify({ session_id: sessionId, window_id: windowId, seq, events });
    if (body.length > (config.maxEventBytes ?? 5_000_000)) return;
    spool.add(sessionId, seq, held, body);
    seq += 1;
  }

  /** Uploads spilled chunks in order; stops at the first retryable failure (the next tick is the backoff). */
  async function drain(): Promise<void> {
    for (const e of [...spool.entries()]) {
      if (e.held) continue;
      const stored = spool.read(e);
      if (stored === null) {
        spool.remove(e);
        continue;
      }
      let status = 0;
      try {
        const r = await d.fetch(`${d.apiHost}/v1/replay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: d.apiKey, ...(JSON.parse(stored) as object) }),
        });
        status = r.ok ? 200 : r.status;
      } catch {
        /* offline: status 0 */
      }
      if (status === 200) spool.remove(e);
      else if (status === 0 || status === 408 || status === 429 || status >= 500) {
        lastFp = null; // a fresh snapshot after the outage
        return;
      } else {
        spool.remove(e); // rejected for good (4xx): retrying cannot help
        d.log?.(`replay chunk rejected with ${status}; dropped`);
      }
    }
  }

  async function tick(): Promise<void> {
    // Revoking either category drops state so a re-grant starts with a clean snapshot.
    if (!consented()) {
      lastFp = null;
      hasSnapshot = false;
      touches = [];
      spool.clear();
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
      // A masked screen (P-M17) forces every switch on and ignores unmask markers natively; patterns (P-M46) star matches.
      const masked = isScreenMasked();
      const raw = await config.module.captureWireframe({
        screen,
        maskText: masked || (config.maskText ?? true),
        maskAllTextInputs: masked || (config.maskAllTextInputs ?? true),
        maskAllImages: masked || (config.maskAllImages ?? true),
        maskSandboxedViews: config.maskSandboxedViews ?? true,
        ...(masked ? { maskScreen: true } : {}),
        ...(patternSources.length > 0 ? { maskTextPatterns: patternSources } : {}),
        ...(shots ? { mode: "screenshot" as const, screenshotQuality: Math.min(1, Math.max(0, config.screenshotQuality ?? 0.4)) } : {}),
      });
      if (!raw) return;
      cap = JSON.parse(raw) as { events?: RrEvent[] };
    } catch {
      return; // a failing capture must never affect the app
    }
    // Patterns again in JS on the wireframe text (the native side already applied them; starring is idempotent).
    const events = (cap.events ?? []).map((e) =>
      e.type === 2 && !shots && patterns.length > 0 ? { ...e, data: { ...e.data, node: maskSnapshotText(e.data.node, patterns) } } : e,
    );
    if (!events.some((e) => e.type === 2)) return;
    const { sessionId, windowId } = core.session.touch();
    const rotated = sessionId !== lastSession;
    if (rotated) {
      lastSession = sessionId;
      sessionStart = now();
      spool.removeHeld(sessionId); // a session cut short is dropped
      seq = spool.nextSeq(sessionId); // resumes after a restart inside the same session
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
    const minMs = effectiveMinDurationMs(config.minDurationMs ?? 0, remote);
    const holding = minMs > 0 && now() - sessionStart < minMs;
    if (out.length > 0) store(out, sessionId, windowId, holding);
    if (holding) return;
    spool.release(sessionId);
    await drain();
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
      // The session ends before it reached the minimum duration: held chunks never went out, so their seq numbers come
      // back and the stream stays gapless. Pending uploads stay.
      const back = spool.removeHeld().filter((e) => e.sid === lastSession).map((e) => e.seq);
      if (back.length > 0) seq = Math.min(...back);
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
    clearSpool: () => spool.clear(),
    tick,
    swipeBegan() {
      if (config.captureDeadSwipes === false || !touchesRecording()) return;
      const s = screen;
      swipeStart = structure().then((fp) => (fp === null ? null : { screen: s, fp }));
    },
    swipeEnded,
    captureSensitive,
  };
}

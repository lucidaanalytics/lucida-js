import { record } from "@rrweb/record";
import type { Host } from "../types.js";
import { createChunker } from "./chunker.js";
import { urlAllowed } from "./config.js";
import type { ResolvedReplay } from "./config.js";
import { textMasker } from "./masktext.js";
import type { TextMasker } from "./masktext.js";
import { pagePrivacy, urlRules } from "./urlrules.js";
import { guardIframeMessages, inIframe, mayPostToParent } from "./iframes.js";
import { pageHeightEmitter } from "./pageheight.js";
import { createRing } from "./ring.js";
import { assetScrubber, resolveAssets } from "./assets.js";
import { maskedCanvasSampler } from "./canvas.js";
import { mutationThrottle } from "./throttle.js";
import { watchTrigger } from "./triggers.js";
import { watchGroups } from "./groups.js";
import type { TriggerGroup } from "./groups.js";
import type { ReplayStatus, StartReason } from "./status.js";
import type { ReplayStartOverride } from "../types.js";

const LEGACY_REASON: Record<string, StartReason> = {
  on_event: "event_trigger_matched",
  on_url: "url_trigger_matched",
  on_flag: "linked_flag_matched",
  on_frustration: "frustration_detected",
};

/** Session start from the UUIDv7 session id (its first 48 bits are the creation time in ms). */
function sessionStart(sid: string): number {
  const ms = parseInt(sid.replace(/-/g, "").slice(0, 12), 16);
  return Number.isFinite(ms) && ms > 0 ? ms : Date.now();
}

const FULL_SNAPSHOT_MS = 5 * 60_000;
/** Custom events lc-replay understands, forwarded from the matching analytics events. */
const MARKERS: Record<string, (p: Record<string, unknown>) => Record<string, unknown>> = {
  $pageview: (p) => ({ url: p.$current_url }),
  $pageleave: () => ({}),
  $form_start: (p) => ({ form: p.form }),
  $form_submit: (p) => ({ form: p.form }),
  $replay_tag: (p) => ({ name: p.name }),
};

interface RrEvent {
  type: number;
  data?: { source?: number };
}

/**
 * Starts rrweb with the privacy defaults and wires chunking, triggers, URL filters and page
 * height. Returns a stop function that discards anything unsent (consent revoked).
 */
export interface Recorder {
  stop(): void;
  /** Manual pause: nothing is recorded or kept until resume(). */
  pause(): void;
  resume(): void;
  paused(): boolean;
}

export function startRecorder(host: Host, cfg: ResolvedReplay, status: ReplayStatus, override?: ReplayStartOverride): Recorder {
  const { core } = host;
  const base = host.config.apiHost;
  const groups = cfg.trigger_groups;
  const t = cfg.trigger.mode;
  // A manual start may bypass the legacy trigger of its kind; trigger groups take the override in watchGroups.
  const legacyForced =
    (t === "on_url" && override?.url_trigger) || (t === "on_event" && override?.event_trigger) || (t === "on_flag" && override?.linked_flag);
  const buffering = groups.length > 0 || (t !== "always" && !legacyForced);
  let live = !buffering;
  let minMs = cfg.min_duration_ms; // a firing group's own min_duration_ms replaces it
  const forced = !!(override?.url_trigger || override?.event_trigger || override?.linked_flag);
  status.startReason = live ? (forced ? "trigger_overridden" : override?.sampling ? "sampling_overridden" : "recording_initialized") : undefined;
  let paused = false; // URL excluded or manually paused; `urlPaused` is the URL part
  let urlPaused = false;
  let manual = false;
  let stopRrweb: (() => void) | undefined;
  let stopped = false;
  const ring = createRing<RrEvent>();
  // strict ("buffer") mode measures this page's recording; "session" mode counts from the session start
  const startedAt = cfg.min_duration_mode === "session" ? sessionStart(core.sessionId) : Date.now();
  status.bufferLength = () => ring.size;
  const sync = (): void => {
    status.status = stopped ? "disabled" : paused ? "paused" : live ? "active" : "buffering";
  };

  const chunker = createChunker({
    url: `${base}/v1/replay`,
    apiKey: host.apiKey,
    fetch: host.fetch,
    ids: () => ({ sessionId: core.sessionId, windowId: core.session.touch().windowId }),
    chunkBytes: cfg.chunk_bytes,
    flushMs: cfg.flush_interval_ms,
    hold: minMs > 0 || groups.some((g) => (g.min_duration_ms ?? 0) > 0),
    onSent: (session, n) => {
      status.flushedBytes += n;
      status.ack(session); // the gateway accepted a chunk: this session has a recording
    },
    onSessionChange: () => {
      try {
        record.takeFullSnapshot(true); // the rotated session needs its own snapshot
      } catch {
        /* not recording */
      }
    },
    log: host.log,
  });

  const height = pageHeightEmitter((h) => {
    try {
      record.addCustomEvent("page_height", { height: h });
    } catch {
      /* not recording right now */
    }
  });

  // URL-scoped rules (P-M16) add masking per page; applyPage() recomputes the selectors before each rrweb start
  const rules = urlRules(cfg.url_privacy_rules);
  let page = pagePrivacy(rules, location.href);
  let maskSel = "";
  let blockSel = "";
  let masker: TextMasker | undefined;
  const applyPage = (): void => {
    maskSel = ["[data-lc-mask]", ...cfg.mask_selectors, ...page.mask].join(",");
    blockSel = ["[data-lc-block]", ...cfg.block_selectors, ...page.block].join(",");
    masker = cfg.mask_all_text || page.maskAllText ? textMasker(maskSel, ["[data-lc-unmask]", ...cfg.unmask_selectors].join(",")) : undefined;
  };
  applyPage();

  status.bufferBytes = () => chunker.unsent;
  const throttle = cfg.mutationThrottle ? mutationThrottle(cfg.mutationThrottle) : undefined;
  status.throttled = () => throttle?.dropped ?? 0;
  const origin = (u: string | undefined): string[] => {
    try {
      return u ? [new URL(u).origin] : [];
    } catch {
      return [];
    }
  };
  const assets = resolveAssets(cfg.assets, cfg.mask_all_text || rules.some((r) => r.mask_all_text), [location.origin, ...origin(base), ...origin(host.config.uiHost)]);
  const assetScrub = assets && (assets.proxy || assets.inlineImages) ? assetScrubber(assets) : undefined;
  // mask regions: rrweb's canvas capture is replaced by the masking sampler (see canvas.ts)
  const maskedCanvas = !!cfg.canvas && (cfg.canvasMask.length > 0 || !!cfg.canvasMaskRegions);
  let sampler: ReturnType<typeof maskedCanvasSampler> | undefined;

  const maskUrl = cfg.maskUrlFn;
  const emit = (e: RrEvent, isCheckout?: boolean): void => {
    if (paused || stopped) return;
    if (throttle && !throttle.allow(e)) return;
    if (e.type === 2) sampler?.reset();
    const getNode = (id: number) => record.mirror.getNode(id);
    masker?.scrub(e, getNode);
    assetScrub?.scrub(e, getNode);
    if (maskUrl && e.type === 4 && typeof (e.data as { href?: unknown })?.href === "string") {
      const d = e.data as { href: string };
      d.href = maskUrl(d.href);
    }
    if (e.type === 3 && e.data?.source === 0) height.schedule(); // DOM mutation
    if (live) chunker.add(e);
    else ring.push(e, !!isCheckout);
  };

  const xo = cfg.crossOriginIframes;
  const child = !!xo && inIframe();
  // An embedded frame that may not post to its parent records nothing (it must not become a second top-level recording).
  const mute = child && !mayPostToParent(xo);
  const unguard = xo && !child ? guardIframeMessages(xo) : undefined;

  const begin = (): void => {
    if (stopRrweb || stopped || mute) return;
    try {
      stopRrweb = rr();
    } catch (err) {
      status.status = "rrweb_error";
      status.rrwebError = String(err).slice(0, 200);
      return;
    }
    if (maskedCanvas && cfg.canvas) {
      sampler = maskedCanvasSampler({
        ...cfg.canvas,
        skip: `${blockSel},[data-lc-ignore]`,
        rules: cfg.canvasMask,
        regionsFn: cfg.canvasMaskRegions,
        idOf: (c) => record.mirror.getId(c),
        emit: (e) => emit(e as RrEvent),
      });
    }
    height.reset();
    sync();
  };
  const rr = (): (() => void) | undefined =>
      record({
        emit,
        checkoutEveryNms: live ? FULL_SNAPSHOT_MS : cfg.buffer_ms / 2,
        maskAllInputs: cfg.mask_all_inputs,
        maskInputOptions: { ...cfg.maskInputOptions, password: true },
        ...(cfg.maskInputFn && { maskInputFn: cfg.maskInputFn }),
        maskTextSelector: masker ? "*" : maskSel,
        ...(masker ? { maskTextFn: masker.maskTextFn } : cfg.maskTextFn && { maskTextFn: cfg.maskTextFn }),
        blockSelector: blockSel,
        ignoreSelector: "[data-lc-ignore]",
        sampling: { mousemove: 50, scroll: 150, input: "last", ...(cfg.canvas && !maskedCanvas && { canvas: cfg.canvas.fps }) },
        ...(cfg.canvas && !maskedCanvas && { dataURLOptions: { type: "image/jpeg", quality: cfg.canvas.quality } }),
        ...(assets?.inlineImages && { inlineImages: true }),
        ...(assets?.collectFonts && { collectFonts: true }),
        errorHandler: (err: unknown) => {
          // an observer threw inside rrweb: keep recording, surface it on events ($replay_rrweb_error*)
          status.rrwebErrors++;
          status.rrwebError = String(err).slice(0, 200);
          return true;
        },
        recordCrossOriginIframes: !!xo,
        slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true },
        recordCanvas: !!cfg.canvas && !maskedCanvas,
      }) ?? undefined;
  const halt = (): void => {
    stopRrweb?.();
    stopRrweb = undefined;
    sampler?.stop();
    sampler = undefined;
  };

  const fire = (reason?: StartReason, g?: TriggerGroup): void => {
    if (live || stopped) return;
    live = true;
    status.startReason = reason ?? LEGACY_REASON[t] ?? "recording_initialized";
    if (g?.min_duration_ms !== undefined) minMs = g.min_duration_ms;
    status.minDurationMs = minMs;
    for (const e of ring.drain()) chunker.add(e);
    halt(); // restart in live mode: new snapshot, 5-minute checkouts
    if (!paused) begin();
    arm();
    sync();
  };

  // min_duration_ms: nothing leaves the page before the session is long enough.
  let minTimer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (!chunker.held || minTimer !== undefined) return;
    minTimer = setTimeout(() => chunker.release(), Math.max(0, minMs - (Date.now() - startedAt)));
  };

  const gw = groups.length
    ? watchGroups(host, groups, () => core.sessionId, (g) => fire("trigger_group_matched", g), {
        url: override?.url_trigger,
        event: override?.event_trigger,
        flag: override?.linked_flag,
        sampling: override?.sampling,
      })
    : undefined;
  const trigger = gw ?? watchTrigger(host, cfg.trigger, () => fire());
  if (gw) {
    status.triggers = gw.states;
    status.matchedGroups = gw.matched;
  }

  let url = "";
  const checkUrl = (): void => {
    if (location.href === url) return;
    url = location.href;
    const next = pagePrivacy(rules, url);
    const remask = next.key !== page.key;
    if (remask) {
      page = next;
      applyPage();
    }
    const wasRunning = !!stopRrweb;
    const ok = urlAllowed(url, cfg.include_urls, cfg.exclude_urls);
    if (!ok && !urlPaused) {
      urlPaused = paused = true;
      halt();
      ring.drain(); // nothing from an excluded page may survive
      void chunker.flush();
      sync();
    } else if (ok && urlPaused) {
      urlPaused = false;
      paused = manual;
      if (!paused) begin();
      sync();
    }
    if (ok) trigger.checkUrl(url);
    if (remask && wasRunning && stopRrweb) {
      halt(); // the new page's masking needs a fresh full snapshot
      begin();
    }
  };
  const urlTimer = setInterval(checkUrl, 1000);

  host.onCapture((e) => {
    // shortcut: between a client-side route change and this check the old page's masking applies; the $pageview hook keeps that gap short
    if (e.event === "$pageview") checkUrl();
    const marker = MARKERS[e.event];
    if (!marker || paused || stopped || !stopRrweb) return;
    try {
      const p = marker(e.properties);
      if (maskUrl && typeof p.url === "string") p.url = maskUrl(p.url);
      record.addCustomEvent(e.event, p);
    } catch {
      /* not recording right now */
    }
  });

  const onVisible = (): void => {
    if (document.visibilityState === "visible") {
      if (live && stopRrweb) record.takeFullSnapshot(true);
    } else chunker.beacon();
  };
  document.addEventListener("visibilitychange", onVisible);
  host.onUnload(() => {
    if (chunker.held) chunker.discard(); // too short to keep
    else chunker.beacon();
  });

  checkUrl();
  gw?.check(); // groups without conditions go live at once
  if (!paused) begin();
  if (live) arm();
  sync();

  const stop = (): void => {
    stopped = true;
    halt();
    clearInterval(urlTimer);
    clearTimeout(minTimer);
    document.removeEventListener("visibilitychange", onVisible);
    unguard?.();
    height.stop();
    trigger.stop();
    ring.drain();
    chunker.discard();
    sync();
  };
  return {
    stop,
    paused: () => paused,
    pause() {
      if (manual || stopped) return;
      manual = paused = true;
      halt();
      ring.drain();
      void chunker.flush();
      sync();
    },
    resume() {
      if (!manual || stopped) return;
      manual = false;
      paused = urlPaused;
      if (!paused) begin(); // fresh full snapshot, so the replay stays playable
      sync();
    },
  };
}

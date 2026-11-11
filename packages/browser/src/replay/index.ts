import type { Module, ReplayStartOverride } from "../types.js";
import type { Recorder } from "./recorder.js";
import { lucidaRecords, policyMatches, resolveReplay } from "./config.js";
import { replayStatus } from "./status.js";
import { sampled } from "./groups.js";
import { attachReplayUrl } from "./support.js";

export { resolveReplay, urlAllowed, lucidaRecords, policyMatches } from "./config.js";
export { pagePrivacy, urlRules } from "./urlrules.js";
export type { PagePrivacy, UrlPrivacyRule } from "./urlrules.js";
export { fnv1a32, sampled } from "./groups.js";
export type { TriggerGroup, TriggerState } from "./groups.js";
export type { RecordingStatus, StartReason } from "./status.js";
export type { AssetCapture } from "./assets.js";
export type { NetworkEntry, NetworkOptions } from "./network.js";
export type { ConsoleEntry } from "./console.js";
export type { CanvasMaskRule, CanvasRegion } from "./canvas.js";
export type { MutationThrottle } from "./throttle.js";
export type { SupportWidgets } from "./support.js";
export type { CanvasCapture, CrossOriginIframes, MaskableInput, ReplayConfig, ReplayOwner, ReplayTrigger, ResolvedReplay } from "./config.js";


/**
 * Session replay module. This file is the small eager loader: it decides whether to record
 * (owner, consent, remote config, sampling) and only then fetches the rrweb recorder chunk.
 * Sampling hashes the session id, so a session is all-in or all-out on every page; with
 * trigger groups each group samples deterministically from the session id instead.
 * Every event carries the recorder state (`$recording_status` and friends) for diagnostics.
 */
export const replay: Module = (host) => {
  const status = replayStatus();
  host.eventExtras.push((sid) => status.props(sid));
  const local = host.config.replay ?? {};
  const off = (why: string): void => {
    status.status = "disabled";
    status.disabledReason = why;
  };
  if (local.enabled === false) return off("disabled_locally");
  const owner = host.config.replayOwner ?? local.owner;
  if (!lucidaRecords(owner)) {
    // An unset owner yields to a Watchtower SDK that is already recording: say so instead of failing silently.
    if (!owner) console.warn("[lucida] replay is off: Watchtower is already recording this page. Set replayOwner: 'lucida' (or 'both') to record with Lucida too.");
    void host.loadConfig(); // the project config (session definition, consent) is not replay's alone: fetch it, consent-gated
    return off("owner_watchtower");
  }
  const nav = navigator as { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return off("data_saver"); // network-quality pause

  let state: "idle" | "starting" | "on" = "idle";
  let rec: Recorder | undefined;
  let gen = 0;
  let userStopped = false; // replay.stop() holds auto-start off until replay.start()
  const startUrl = location.href; // a session that starts on a never-record page is never recorded
  const consented = (): boolean => host.core.hasConsent("analytics") && host.core.hasConsent("replay");

  /** A manual start (replay.start()) skips sampling and, when asked, triggers; consent, owner, remote kill-switch and never-record pages still apply. */
  const start = async (manual?: ReplayStartOverride): Promise<void> => {
    if (state !== "idle") return;
    if (!consented()) return off("no_consent");
    state = "starting";
    status.status = "awaiting_config";
    const mine = ++gen;
    const remote = await host.loadConfig();
    const never = policyMatches(remote?.replay_never_record, startUrl) || (!!manual && policyMatches(remote?.replay_never_record, location.href));
    const cfg = never ? null : resolveReplay(local, remote);
    if (mine !== gen) return void (state = "idle");
    if (!cfg) {
      off(never ? "never_record_page" : "remote_disabled");
      return void (state = "idle");
    }
    const sid = host.core.sessionId;
    const groups = cfg.trigger_groups.length > 0;
    // deterministic per session id (same answer on every page and in every SDK); groups sample per group instead
    const sampledIn = !!manual?.sampling || groups || sampled(sid, "", cfg.sample_rate);
    status.sampleRate = groups ? undefined : cfg.sample_rate;
    status.minDurationMs = cfg.min_duration_ms;
    if (!sampledIn) {
      status.status = "sampled";
      return void (state = "idle");
    }
    status.status = "lazy_loading";
    status.disabledReason = undefined;
    const { startRecorder } = await import("./recorder.js");
    if (mine !== gen) return void (state = "idle");
    rec = startRecorder(host, cfg, status, manual);
    state = "on";
  };
  const halt = (): void => {
    gen++; // cancels a start in flight
    rec?.stop();
    rec = undefined;
    state = "idle";
  };

  host.replay = {
    start: async (o) => {
      userStopped = false;
      const all = o === true;
      const pick = (k: keyof ReplayStartOverride): boolean => all || (typeof o === "object" && !!o[k]);
      await start({ sampling: o === undefined || pick("sampling"), url_trigger: pick("url_trigger"), event_trigger: pick("event_trigger"), linked_flag: pick("linked_flag") });
    },
    stop: () => {
      userStopped = true;
      halt();
      off("stopped_manually");
    },
    pause: () => rec?.pause(),
    resume: () => rec?.resume(),
    tag: (name) => host.client.capture("$replay_tag", { name, session_id: host.core.sessionId }),
    isRecording: () => state === "on" && !rec?.paused(),
  };

  host.core.onChange((c) => {
    if (c !== "consent") return;
    if (consented()) {
      if (!userStopped) void start();
    } else {
      halt();
      off("no_consent");
    }
  });
  void start();
  const sw = local.supportWidgets;
  const detach = sw?.intercom || sw?.crisp ? attachReplayUrl(sw, () => host.client.getReplayUrl(), () => state === "on" && !rec?.paused()) : undefined;
  return () => {
    gen++;
    rec?.stop();
    detach?.();
  };
};

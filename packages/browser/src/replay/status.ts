import type { Props } from "@lucida/sdk-core";
import type { TriggerState } from "./groups.js";

/** What the recorder is doing, stamped on every event as `$recording_status` (replay diagnostics). */
export type RecordingStatus =
  | "disabled"
  | "awaiting_config"
  | "sampled"
  | "lazy_loading"
  | "buffering"
  | "active"
  | "paused"
  | "rrweb_error";

export type StartReason =
  | "recording_initialized"
  | "sampling_overridden"
  | "trigger_overridden"
  | "url_trigger_matched"
  | "event_trigger_matched"
  | "linked_flag_matched"
  | "trigger_group_matched"
  | "frustration_detected";

const ACK_KEY = "lc_replay_ack";
const readAck = (): string[] => {
  try {
    const v = sessionStorage.getItem(ACK_KEY);
    return v ? [v] : [];
  } catch {
    return [];
  }
};

/** Mutable diagnostics shared by the loader and the recorder; `props()` is read at event time. */
export function replayStatus() {
  const s = {
    status: "awaiting_config" as RecordingStatus,
    disabledReason: undefined as string | undefined,
    startReason: undefined as StartReason | undefined,
    sampleRate: undefined as number | undefined,
    minDurationMs: undefined as number | undefined,
    triggers: undefined as (() => { url: TriggerState; event: TriggerState; flag: TriggerState }) | undefined,
    matchedGroups: undefined as (() => string[]) | undefined,
    bufferLength: undefined as (() => number) | undefined,
    flushedBytes: 0,
    /** Session ids the gateway acknowledged a chunk for (this tab's acks survive page loads). */
    confirmed: new Set<string>(readAck()),
    rrwebError: undefined as string | undefined,
    /** rrweb observer errors swallowed while recording (rrweb `errorHandler`). */
    rrwebErrors: 0,
    /** Unsent recording bytes (open chunk plus chunks waiting to be posted). */
    bufferBytes: undefined as (() => number) | undefined,
    throttled: undefined as (() => number) | undefined,
  };
  return Object.assign(s, {
    /** The gateway accepted a chunk of `sessionId`: every later event (on any page of this tab) says `$has_recording`. */
    ack(sessionId: string): void {
      if (s.confirmed.has(sessionId)) return;
      s.confirmed.add(sessionId);
      try {
        sessionStorage.setItem(ACK_KEY, sessionId); // only reached while recording, i.e. with replay consent
      } catch {
        /* storage blocked: this page only */
      }
    },
    props(sessionId: string): Props {
      const t = s.triggers?.();
      const p: Props = {
        $recording_status: s.status,
        $has_recording: s.confirmed.has(sessionId),
      };
      if (s.disabledReason) p.$replay_disabled_reason = s.disabledReason;
      if (s.startReason) p.$session_recording_start_reason = s.startReason;
      if (s.sampleRate !== undefined) p.$replay_sample_rate = s.sampleRate;
      if (s.minDurationMs !== undefined) p.$replay_minimum_duration = s.minDurationMs;
      if (t) {
        p.$replay_url_trigger_status = t.url;
        p.$replay_event_trigger_status = t.event;
        p.$replay_linked_flag_trigger_status = t.flag;
      }
      const m = s.matchedGroups?.();
      if (m?.length) p.$replay_trigger_groups_matched = m;
      if (s.bufferLength) p.$replay_buffer_length = s.bufferLength();
      if (s.flushedBytes) p.$replay_flushed_size = s.flushedBytes;
      if (s.rrwebError) p.$replay_rrweb_error = s.rrwebError;
      if (s.rrwebErrors) p.$replay_rrweb_error_count = s.rrwebErrors;
      const b = s.bufferBytes?.();
      if (b) p.$replay_buffer_size = b;
      const th = s.throttled?.();
      if (th) p.$replay_throttled_mutations = th;
      return p;
    },
  });
}

export type ReplayStatus = ReturnType<typeof replayStatus>;

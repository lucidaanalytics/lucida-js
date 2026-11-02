import type { Clock, Storage } from "./ports.js";
import { uuidv7 } from "./uuid.js";

const KEY = "lc_session";

interface SessionState {
  id: string;
  start: number;
  last: number;
  campaign?: string;
}

export interface SessionOptions {
  idleMs?: number;
  maxMs?: number;
  /** Event names that always start a new session (project session definition, N-ANA-6). */
  newOnEvents?: string[];
  clock?: Clock;
  /** Id to adopt when no session is stored yet (server-side bootstrap). */
  bootstrapId?: string;
}

export interface SessionInfo {
  sessionId: string;
  windowId: string;
  /** True when this call started a new session. */
  isNew: boolean;
}

/** The session keys of `GET /v1/config` (settings.sdk, N-ANA-6); the worker splits sessions on the same rule. */
export interface RemoteSessionSettings {
  session_idle_minutes?: number;
  session_max_minutes?: number;
  session_new_on_events?: string[];
}

/** `v` minutes as ms when it is a whole number in [lo, hi]. */
function minutes(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v * 60_000 : undefined;
}

/**
 * Client sessions: UUIDv7 rotated after 30 min idle, 24 h total, a campaign (UTM) change, or one of the
 * project's "new session" events. State lives in storage so tabs share a session; window id is per manager
 * instance (per tab).
 */
export class SessionManager {
  private readonly windowId = uuidv7();
  private idleMs: number;
  private maxMs: number;
  private newOn: string[];
  private readonly clock: Clock;
  private bootstrapId: string | undefined;

  constructor(
    private readonly storage: Storage,
    private readonly o: SessionOptions = {},
  ) {
    this.idleMs = o.idleMs ?? 30 * 60_000;
    this.maxMs = o.maxMs ?? 24 * 3_600_000;
    this.newOn = o.newOnEvents ?? [];
    this.clock = o.clock ?? Date;
    this.bootstrapId = o.bootstrapId;
  }

  /**
   * Adopt the project's session definition from the remote config. Values passed in code win; missing or
   * out-of-range remote values leave the current setting.
   */
  configure(r: RemoteSessionSettings): void {
    if (this.o.idleMs === undefined) this.idleMs = minutes(r.session_idle_minutes, 1, 1440) ?? this.idleMs;
    if (this.o.maxMs === undefined) this.maxMs = minutes(r.session_max_minutes, 5, 10_080) ?? this.maxMs;
    if (this.o.newOnEvents === undefined && Array.isArray(r.session_new_on_events)) {
      this.newOn = r.session_new_on_events.filter((e): e is string => typeof e === "string" && e !== "");
    }
  }

  private read(): SessionState | undefined {
    try {
      const raw = this.storage.get(KEY);
      return raw ? (JSON.parse(raw) as SessionState) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Record activity (an event, named by `event`) and return the current session, rotating if needed. */
  touch(campaignKey?: string, event?: string): SessionInfo {
    const now = this.clock.now();
    let s = this.read();
    const campaignChanged = !!(s?.campaign && campaignKey && s.campaign !== campaignKey);
    const ruleEvent = event !== undefined && this.newOn.includes(event);
    const isNew = !s || now - s.last > this.idleMs || now - s.start > this.maxMs || campaignChanged || ruleEvent;
    if (isNew || !s) s = { id: (!s && this.bootstrapId) || uuidv7(now), start: now, last: now };
    this.bootstrapId = undefined;
    s.last = now;
    if (campaignKey) s.campaign = campaignKey;
    this.storage.set(KEY, JSON.stringify(s));
    return { sessionId: s.id, windowId: this.windowId, isNew };
  }

  /** When the stored session began (epoch ms), without recording activity. */
  startedAt(): number | undefined {
    return this.read()?.start;
  }

  reset(): void {
    this.storage.remove(KEY);
  }
}

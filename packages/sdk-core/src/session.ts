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

/**
 * Client sessions: UUIDv7 rotated after 30 min idle, 24 h total, or a campaign (UTM) change.
 * State lives in storage so tabs share a session; window id is per manager instance (per tab).
 */
export class SessionManager {
  private readonly windowId = uuidv7();
  private readonly idleMs: number;
  private readonly maxMs: number;
  private readonly clock: Clock;
  private bootstrapId: string | undefined;

  constructor(
    private readonly storage: Storage,
    o: SessionOptions = {},
  ) {
    this.idleMs = o.idleMs ?? 30 * 60_000;
    this.maxMs = o.maxMs ?? 24 * 3_600_000;
    this.clock = o.clock ?? Date;
    this.bootstrapId = o.bootstrapId;
  }

  private read(): SessionState | undefined {
    try {
      const raw = this.storage.get(KEY);
      return raw ? (JSON.parse(raw) as SessionState) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Record activity (an event) and return the current session, rotating if needed. */
  touch(campaignKey?: string): SessionInfo {
    const now = this.clock.now();
    let s = this.read();
    const campaignChanged = !!(s?.campaign && campaignKey && s.campaign !== campaignKey);
    const isNew = !s || now - s.last > this.idleMs || now - s.start > this.maxMs || campaignChanged;
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

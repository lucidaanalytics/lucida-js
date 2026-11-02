import { Consent, GatedStorage } from "./consent.js";
import type { ConsentCategory, ConsentDefault, ConsentMode, ConsentState, ConsentStatus } from "./consent.js";
import { Identity } from "./identity.js";
import { EventQueue } from "./queue.js";
import type { QueueOptions } from "./queue.js";
import { SessionManager } from "./session.js";
import type { RemoteSessionSettings, SessionInfo } from "./session.js";
import { Groups, SuperProps } from "./state.js";
import type { Clock, Props, Storage, Transport, WireEvent } from "./ports.js";
import { uuidv7 } from "./uuid.js";

export interface Enrichment {
  properties?: Props;
  $set?: Props;
  $set_once?: Props;
}

export interface CoreConfig {
  apiKey: string;
  apiHost: string;
  transport: Transport;
  /** Real persistence; the core wraps it so nothing is written before consent. */
  storage: Storage;
  /** Where the consent decision itself is kept (default `storage`). Written only on an explicit decision. */
  consentStorage?: Storage;
  /** Which super properties (`register`) are persisted; the rest live in memory for this page. Default: all. */
  persistProperty?: (key: string) => boolean;
  library: { name: string; version: string };
  clock?: Clock;
  consent?: {
    mode?: ConsentMode;
    queueBeforeConsent?: boolean;
    respectDnt?: boolean;
    dnt?: boolean;
    storageKey?: string;
    /**
     * After an explicit denial keep counting anonymously: events go out without distinct_id (the gateway derives its
     * daily cookieless id; the project needs cookieless mode), nothing is stored, and identify/alias/person properties
     * are withheld. A later grant switches to normal identity.
     */
    cookielessOnReject?: boolean;
    /** Hold storage and events until applyRemote() delivers the project's geo consent default (N-ANA-17). */
    awaitRemote?: boolean;
  };
  queue?: Pick<QueueOptions, "flushAt" | "flushIntervalMs" | "maxQueueSize" | "maxRetries" | "backoff">;
  bootstrapDistinctId?: string;
  /** Cookieless: no anonymous distinct_id; events omit it until identify(). */
  cookieless?: boolean;
  /** Platform properties added to every event (url, screen, ...). */
  enrich?: (event: string, props: Props) => Enrichment | undefined;
  /** Current campaign signature (e.g. joined UTM params); a change rotates the session. */
  campaignKey?: () => string | undefined;
  /** Session rotation limits (default 30 min idle, 24 h total), events that start a session, a bootstrapped session id. */
  session?: { idleMs?: number; maxMs?: number; newOnEvents?: string[]; bootstrapId?: string };
  /** bootstrapDistinctId belongs to a signed-in user. */
  bootstrapIdentified?: boolean;
  log?: (...a: unknown[]) => void;
  onCapture?: (e: WireEvent) => void;
  onDrop?: (events: WireEvent[], reason: string) => void;
}

export interface CaptureExtras {
  /** Event time instead of now (epoch ms, ISO string or Date). */
  timestamp?: number | string | Date;
  $set?: Props;
  $set_once?: Props;
  $unset?: string[];
}

/** ISO time for a caller-supplied timestamp; now when it is missing or unparseable. */
function validTime(t: CaptureExtras["timestamp"], now: number): string {
  const d = new Date(t ?? now);
  return (Number.isNaN(d.getTime()) ? new Date(now) : d).toISOString();
}

export type CoreChange = "identify" | "reset" | "group" | "consent";

/** Platform-agnostic client: identity, sessions, consent gating, super props, groups, queue. */
export class Core {
  readonly consent: Consent;
  readonly identity: Identity;
  readonly session: SessionManager;
  readonly queue: EventQueue;
  /** Consent-gated storage: modules persist their own state through this, never the raw adapter. */
  readonly storage: Storage;
  private readonly gated: GatedStorage;
  private readonly props: SuperProps;
  private readonly groupState: Groups;
  private readonly clock: Clock;
  private device: string | undefined;
  private readonly pre: WireEvent[] = [];
  private readonly listeners: Array<(c: CoreChange) => void> = [];
  private readonly captureListeners: Array<(e: WireEvent) => void> = [];
  private readonly sessionListeners: Array<(sessionId: string, windowId: string) => void> = [];
  private lastSession = "";
  private filter: ((e: WireEvent) => WireEvent | null) | undefined;

  constructor(private readonly c: CoreConfig) {
    this.clock = c.clock ?? Date;
    this.consent = new Consent({ ...c.consent, storage: c.consentStorage ?? c.storage });
    this.gated = new GatedStorage(c.storage, () => this.consent.has("analytics"));
    this.storage = this.gated;
    this.identity = new Identity(this.gated, c.bootstrapDistinctId, c.cookieless, c.bootstrapIdentified);
    this.session = new SessionManager(this.gated, { clock: this.clock, ...c.session });
    this.props = new SuperProps(this.gated, undefined, c.persistProperty);
    this.groupState = new Groups(this.gated);
    this.queue = new EventQueue({
      transport: c.transport,
      url: `${c.apiHost.replace(/\/+$/, "")}/v1/batch`,
      apiKey: c.apiKey,
      clock: this.clock,
      ...(c.log ? { log: c.log } : {}),
      ...(c.onDrop ? { onDrop: c.onDrop } : {}),
      ...c.queue,
    });
  }

  /** Pre-identify id for flag continuity (see Identity.priorAnonId). */
  get anonDistinctId(): string | undefined {
    return this.identity.priorAnonId;
  }

  get distinctId(): string {
    return this.identity.distinctId;
  }

  /**
   * Stable per-browser id for flags with device stickiness: survives identify() and reset() (it names the
   * device, not the user). Persisted through the consent-gated storage; empty in cookieless mode.
   */
  get deviceId(): string {
    if (this.c.cookieless) return "";
    if (!this.device) {
      this.device = this.gated.get("lc_device_id") || uuidv7();
      this.gated.set("lc_device_id", this.device);
    }
    return this.device;
  }

  get groups(): Record<string, string> | undefined {
    return this.groupState.all();
  }

  get sessionId(): string {
    return this.touchSession().sessionId;
  }

  private touchSession(event?: string): SessionInfo {
    const s = this.session.touch(this.c.campaignKey?.(), event);
    if (s.sessionId !== this.lastSession) {
      this.lastSession = s.sessionId;
      for (const l of this.sessionListeners) l(s.sessionId, s.windowId);
    }
    return s;
  }

  /** Called with the session id on first touch and again whenever it rotates or is reset. */
  onSessionId(fn: (sessionId: string, windowId: string) => void): () => void {
    this.sessionListeners.push(fn);
    return () => void this.sessionListeners.splice(this.sessionListeners.indexOf(fn), 1);
  }

  /** When the current session began (epoch ms), if one exists. */
  get sessionStart(): number | undefined {
    return this.session.startedAt();
  }

  /** A registered super property. */
  getProperty(key: string): unknown {
    return this.props.all()[key];
  }

  /**
   * One policy step every event passes right after it is built and before anyone sees it: return the (amended)
   * event, or null to drop it. Capture listeners and the queue only get what it returns.
   */
  setFilter(fn: ((e: WireEvent) => WireEvent | null) | undefined): void {
    this.filter = fn;
  }

  onChange(fn: (c: CoreChange) => void): void {
    this.listeners.push(fn);
  }

  /** Observe every event that passes the consent gate (triggers, inspector). */
  onCaptured(fn: (e: WireEvent) => void): void {
    this.captureListeners.push(fn);
  }

  private emit(c: CoreChange): void {
    for (const l of this.listeners) l(c);
  }

  /** Explicit consent decision: pending (never asked), granted or denied. */
  consentStatus(): ConsentStatus {
    return this.consent.status();
  }

  /** True while events go out anonymously because the visitor declined (consent.cookielessOnReject). */
  get anonymousOnReject(): boolean {
    return !!this.c.consent?.cookielessOnReject && this.consent.status() === "denied";
  }

  capture(event: string, props: Props = {}, extra: CaptureExtras = {}): WireEvent | undefined {
    const granted = this.consent.has("analytics");
    const anon = !granted && (this.anonymousOnReject || this.consent.anonymous);
    const hold = this.consent.pending && (this.consent.queueBeforeConsent || this.consent.resolving);
    if (!granted && !anon && !hold) {
      this.c.log?.("dropped (no consent)", event);
      return undefined;
    }
    if (anon && (event === "$identify" || event === "$create_alias")) {
      this.c.log?.("withheld (declined, anonymous mode)", event);
      return undefined;
    }
    const s = this.touchSession(event);
    const en = this.c.enrich?.(event, props);
    // The consent log also stores the decision on the person, so server-side events and audience syncs
    // can be checked against it (per-destination consent, P-H7).
    const decided = this.consent.status() !== "pending";
    const $set = anon ? {} : { ...en?.$set, ...extra.$set, ...(event === "$consent_updated" && decided ? { $consent: this.consent.get() } : {}) };
    const $set_once = anon ? {} : { ...en?.$set_once, ...extra.$set_once };
    const groups = this.groupState.all();
    const did = anon ? "" : this.identity.distinctId;
    const built: WireEvent = {
      uuid: uuidv7(this.clock.now()),
      event,
      ...(did ? { distinct_id: did } : {}),
      timestamp: validTime(extra.timestamp, this.clock.now()),
      properties: {
        ...this.props.all(),
        ...en?.properties,
        ...props,
        $session_id: s.sessionId,
        $window_id: s.windowId,
        $lib: this.c.library.name,
        $lib_version: this.c.library.version,
        // Destinations deliver only what the visitor consented to; no explicit decision = no `$consent`.
        ...(decided ? { $consent: this.consent.get() } : {}),
      },
      ...(Object.keys($set).length ? { $set } : {}),
      ...(Object.keys($set_once).length ? { $set_once } : {}),
      ...(!anon && extra.$unset?.length ? { $unset: extra.$unset } : {}),
      ...(groups ? { $groups: groups } : {}),
    };
    const e = this.filter ? this.filter(built) : built;
    if (!e) {
      this.c.log?.("dropped (policy)", event);
      return undefined;
    }
    this.c.log?.("capture", event, e);
    this.c.onCapture?.(e);
    for (const l of this.captureListeners) l(e);
    if (granted || anon) this.queue.enqueue(e);
    else if (this.pre.length < (this.c.queue?.maxQueueSize ?? 1000)) this.pre.push(e);
    return e;
  }

  identify(id: string, $set?: Props, $set_once?: Props): void {
    const r = this.identity.identify(id);
    if (r.event || $set || $set_once) {
      this.capture(
        "$identify",
        r.anonDistinctId ? { $anon_distinct_id: r.anonDistinctId } : {},
        { ...($set ? { $set } : {}), ...($set_once ? { $set_once } : {}) },
      );
    }
    this.emit("identify");
  }

  /** Link `alias` to the current (or given) distinct id. */
  alias(alias: string, original?: string): void {
    this.capture("$create_alias", this.identity.aliasProps(alias, original));
  }

  /** `resetDeviceId` also forgets the stable device id; `reuseAnonymousId` keeps this device's first anonymous id. */
  reset(o: { resetDeviceId?: boolean; reuseAnonymousId?: boolean } = {}): void {
    this.identity.reset(o.reuseAnonymousId);
    if (o.resetDeviceId) {
      this.device = undefined;
      this.gated.remove("lc_device_id");
    }
    this.props.clear();
    this.groupState.clear();
    this.session.reset();
    this.lastSession = "";
    this.emit("reset");
  }

  register(p: Props): void {
    this.props.register(p);
  }

  registerOnce(p: Props): void {
    this.props.registerOnce(p);
  }

  unregister(key: string): void {
    this.props.unregister(key);
  }

  group(type: string, key: string, properties?: Props): void {
    this.groupState.set(type, key);
    this.capture("$groupidentify", { $group_type: type, $group_key: key, $group_set: properties ?? {} });
    this.emit("group");
  }

  getConsent(): ConsentState {
    return this.consent.get();
  }

  /** `pending` until the visitor decided, then `granted` or `denied` for the category (default analytics). */
  getConsentStatus(c: ConsentCategory = "analytics"): ConsentStatus {
    return this.consent.status(c);
  }

  hasConsent(c: ConsentCategory): boolean {
    return this.consent.has(c);
  }

  /** Record a consent decision. Granting analytics releases state and held events; revoking drops them. */
  setConsent(update: Partial<ConsentState>): void {
    const was = this.consent.has("analytics");
    const will = update.analytics ?? was;
    if (was && !will) {
      this.capture("$opt_out");
      void this.queue.flush();
    }
    // Anonymous events go out in their own batch, never mixed with identified ones.
    if (!was && will && (this.anonymousOnReject || this.consent.anonymous)) void this.queue.flush();
    this.consent.set(update);
    if (!was && will) {
      this.gated.flushBuffered();
      for (const e of this.pre.splice(0)) this.queue.enqueue(e);
      this.capture("$opt_in");
    } else if (was && !will) {
      this.queue.clear();
    }
    if (!will) this.pre.length = 0;
    this.emit("consent");
  }

  /** Apply the project settings of `GET /v1/config`: the session definition and the geo consent default. */
  applyRemote(r: RemoteSessionSettings & { consent_default?: string }): void {
    this.session.configure(r);
    const d = r.consent_default;
    this.resolveConsent(d === "opt_in" || d === "opt_out" || d === "cookieless" ? d : undefined);
  }

  /**
   * Settle a consent that awaits its geo default (no-op otherwise). Granted: buffered state is stored and held events
   * are sent. Cookieless: buffered state is dropped and held events go out without ids. Opt-in: events stay held
   * (queueBeforeConsent) or are dropped, and nothing is stored until the visitor decides.
   */
  resolveConsent(def: ConsentDefault | undefined): void {
    if (!this.consent.resolving) return;
    const granted = this.consent.resolve(def);
    const held = this.pre.splice(0);
    if (granted) {
      this.gated.flushBuffered();
      for (const e of held) this.queue.enqueue(e);
    } else if (this.consent.anonymous) {
      this.gated.discardBuffered();
      for (const e of held) {
        if (e.event === "$identify" || e.event === "$create_alias") continue;
        const anon: WireEvent = { ...e };
        delete anon.distinct_id;
        delete anon.$set;
        delete anon.$set_once;
        delete anon.$unset;
        this.queue.enqueue(anon);
      }
    } else if (this.consent.queueBeforeConsent) {
      this.pre.push(...held);
    }
    this.emit("consent");
  }

  optIn(): void {
    this.setConsent({ analytics: true, replay: true, marketing: true });
  }

  optOut(): void {
    this.setConsent({ analytics: false, replay: false, marketing: false });
  }

  flush(opts?: { beacon?: boolean }): Promise<void> {
    return this.queue.flush(opts);
  }

  shutdown(): Promise<void> {
    return this.queue.shutdown();
  }
}

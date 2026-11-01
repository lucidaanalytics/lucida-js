import { EventQueue, FlagSnapshot, backoffDelay, isRetryable, uuidv7, withFlagProps } from "@lucida/sdk-core";
import type { BackoffOptions, FlagDefinition, FlagValue, Props, StickyStore, Transport, WireEvent } from "@lucida/sdk-core";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getContext } from "./context.js";
import type { FlagDefinitionCacheProvider } from "./defcache.js";
import { DefinitionsPoller } from "./definitions.js";
import type { DefinitionsResponse } from "./definitions.js";
import { ServerFlags } from "./flags.js";
import type { FlagOptions } from "./flags.js";
import { LruSet } from "./lru.js";
import { nodeTransport } from "./transport.js";

export const LIB_VERSION = "0.0.0";
const LIB = "lucida-node";
const MAX_BATCH = 1000;

export interface LucidaOptions {
  host?: string;
  flushAt?: number;
  flushIntervalMs?: number;
  /** Secret key (lc_sk_): enables local flag evaluation and historical import. */
  secretKey?: string;
  /** Alias of secretKey. */
  personalApiKey?: string;
  /** Definitions poll interval, default 30 000. */
  featureFlagsPollingIntervalMs?: number;
  /** Consume the SSE flag stream for near-real-time definition updates (falls back to polling). Default true. */
  streamFlags?: boolean;
  /** Reconnect backoff for the flag stream (tests). */
  streamBackoff?: BackoffOptions;
  /** Persistent sticky bucketing for local evaluation: units keep their first value of a `sticky` flag. Use a shared store (Redis, a table) across processes. */
  stickyStore?: StickyStore;
  /** Per-request timeout, default 10 000. */
  timeoutMs?: number;
  /** No events, no network. */
  disabled?: boolean;
  debug?: boolean;
  /** Per-request timeout for flag calls (definitions poll and /v1/flags); default `timeoutMs`. */
  flagsTimeoutMs?: number;
  /** Queue bound; the oldest events are dropped beyond it (default 1000). */
  maxQueueSize?: number;
  /** Super properties on every event (also `register`); context and per-event properties win. */
  defaultProperties?: Props;
  /** Events per request (1..1000), independent of `flushAt`. Default 1000. */
  maxBatchSize?: number;
  /** Delivery retries for a failing batch (default 5) and the first backoff step (default 1000 ms, doubling, jittered). */
  fetchRetryCount?: number;
  fetchRetryDelayMs?: number;
  /** Edit or drop (return null) every wire event before it is queued. If the hook throws, the original event is kept. */
  beforeSend?: (event: WireEvent) => WireEvent | null;
  /** Called when a batch is dropped (queue full, non-retryable status, retries exhausted) or `captureImmediate` fails. */
  onError?: (error: Error, events: WireEvent[]) => void;
  /** Send `$geoip_disable: true` on every event (per event: `CaptureInput.disableGeoip`). */
  disableGeoip?: boolean;
  /** Add `$is_server: true` to every event. */
  isServer?: boolean;
  /** Entries kept for `$feature_flag_called` dedup (default 10 000). */
  maxCacheSize?: number;
  /** Share the definitions fetch between workers (Redis, KV). See `FlagDefinitionCacheProvider`. */
  flagDefinitionCacheProvider?: FlagDefinitionCacheProvider;
  /** Test/advanced overrides. */
  fetch?: typeof fetch;
  transport?: Transport;
  /**
   * Offline, deterministic mode for tests: no network at all, flags evaluate locally from `fixture` (a file written by
   * `lucida flags fixture`, a `{flags: [...]}` body or a definitions array), and events land in `lucida.captured`.
   * Flags that need the server (cohorts) or are not in the fixture read as undefined.
   */
  testMode?: { fixture: string | DefinitionsResponse | FlagDefinition[] };
  /** `captureImmediate` attempts in total (default 3) and first backoff step (default 200 ms, doubling, capped at 2 s). */
  immediateAttempts?: number;
  immediateRetryDelayMs?: number;
  /** App contexts this server declares; flags limited to other contexts are not served. */
  appContexts?: string[];
}

export interface CaptureInput {
  /** Falls back to the active `withContext` distinct id; with `processPersonProfile: false` and none, a random UUID. */
  distinctId?: string;
  event: string;
  properties?: Props;
  groups?: Record<string, string>;
  timestamp?: Date | string | number;
  uuid?: string;
  $set?: Props;
  $set_once?: Props;
  /**
   * Attach `$feature/<key>` and `$active_feature_flags`: true evaluates the distinct id's flags (locally when
   * definitions are loaded, else one POST /v1/flags; the event is queued once they are known). Pass options to
   * shape that evaluation.
   */
  sendFeatureFlags?: boolean | FlagOptions;
  /** Attach exactly these values (from evaluateFlags); no evaluation, no network, no exposure events. */
  flags?: FlagSnapshot;
  /** false sends `$process_person_profile: false`: no person row is created or updated; `$set` / `$set_once` are dropped. */
  processPersonProfile?: boolean;
  /** Overrides the client default for this event. */
  disableGeoip?: boolean;
}

export type ImportEvent = Omit<CaptureInput, "groups" | "uuid" | "distinctId"> & { distinctId: string; uuid?: string };

function loadFixture(f: string | DefinitionsResponse | FlagDefinition[]): FlagDefinition[] {
  const body = typeof f === "string" ? (JSON.parse(readFileSync(f, "utf8")) as DefinitionsResponse | FlagDefinition[]) : f;
  const flags = Array.isArray(body) ? body : body.flags;
  if (!Array.isArray(flags)) throw new Error("testMode fixture must be {flags: [...]} or an array of definitions");
  return flags;
}

const iso = (t: Date | string | number | undefined): string => new Date(t ?? Date.now()).toISOString();

/** Server SDK. Name a distinctId per call, or run inside `withContext` and omit it. */
export class Lucida {
  private readonly queue: EventQueue;
  private readonly poller: DefinitionsPoller | undefined;
  private readonly flags: ServerFlags;
  private readonly host: string;
  private readonly secretKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly log: (...a: unknown[]) => void;
  private readonly off: boolean;
  private readonly test: boolean;
  private readonly transport: Transport;
  private readonly cfg: Pick<LucidaOptions, "beforeSend" | "onError" | "disableGeoip" | "isServer" | "flagDefinitionCacheProvider" | "immediateAttempts" | "immediateRetryDelayMs">;
  private readonly superProps: Props;
  /** identify/groupIdentify calls already sent in this process (id + props hash), bounded. */
  private readonly sentIdentities = new LruSet(1000);
  /** testMode only: every event captured (including `$feature_flag_called` / `$exposure`), in order. */
  readonly captured: WireEvent[] = [];
  /** Resolves after the first definitions fetch (immediately when local evaluation is off). */
  readonly ready: Promise<void>;

  constructor(
    private readonly apiKey: string,
    o: LucidaOptions = {},
  ) {
    this.host = (o.host ?? "https://app.lucida.dev").replace(/\/+$/, "");
    this.test = !!o.testMode;
    this.fetchImpl = this.test
      ? ((() => Promise.reject(new Error("network disabled in testMode"))) as typeof fetch)
      : (o.fetch ?? fetch);
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.secretKey = o.secretKey ?? o.personalApiKey;
    this.off = !!o.disabled;
    this.log = o.debug ? (...a) => console.debug("[lucida]", ...a) : () => undefined;
    this.cfg = o;
    this.superProps = { ...o.defaultProperties };
    this.transport = o.transport ?? nodeTransport({ fetch: this.fetchImpl, timeoutMs: this.timeoutMs });
    const flagsTimeoutMs = o.flagsTimeoutMs ?? this.timeoutMs;
    this.queue = new EventQueue({
      transport: this.transport,
      url: `${this.host}/v1/batch`,
      apiKey,
      flushAt: o.flushAt ?? 20,
      flushIntervalMs: o.flushIntervalMs ?? 10_000,
      log: this.log,
      ...(o.maxBatchSize !== undefined ? { maxBatchSize: o.maxBatchSize } : {}),
      ...(o.maxQueueSize !== undefined ? { maxQueueSize: o.maxQueueSize } : {}),
      ...(o.fetchRetryCount !== undefined ? { maxRetries: o.fetchRetryCount } : {}),
      ...(o.fetchRetryDelayMs !== undefined ? { backoff: { baseMs: o.fetchRetryDelayMs } } : {}),
      onDrop: (events, reason) => this.fail(new Error(`dropped ${events.length} events: ${reason}`), events),
    });
    const fixtureDefs = o.testMode ? loadFixture(o.testMode.fixture) : undefined;
    this.poller =
      this.secretKey && !this.off && !this.test
        ? new DefinitionsPoller({
            url: `${this.host}/v1/flags/definitions`,
            secretKey: this.secretKey,
            fetch: this.fetchImpl,
            timeoutMs: flagsTimeoutMs,
            ...(o.flagDefinitionCacheProvider ? { cache: o.flagDefinitionCacheProvider } : {}),
            intervalMs: o.featureFlagsPollingIntervalMs ?? 30_000,
            ...(o.streamFlags === false ? {} : { streamUrl: `${this.host}/v1/flags/stream` }),
            ...(o.streamBackoff ? { streamBackoff: o.streamBackoff } : {}),
            log: this.log,
          })
        : undefined;
    this.ready = this.poller?.start() ?? Promise.resolve();
    this.flags = new ServerFlags({
      poller: fixtureDefs ? { defs: fixtureDefs } : this.poller,
      host: this.host,
      apiKey,
      fetch: this.fetchImpl,
      timeoutMs: flagsTimeoutMs,
      ...(o.maxCacheSize !== undefined ? { dedupCacheSize: o.maxCacheSize } : {}),
      log: this.log,
      capture: (distinctId, event, properties) => this.capture({ distinctId, event, properties }),
      ...(o.stickyStore ? { sticky: o.stickyStore } : {}),
      ...(o.appContexts ? { appContexts: o.appContexts } : {}),
    });
  }

  private fail(error: Error, events: WireEvent[]): void {
    try {
      this.cfg.onError?.(error, events);
    } catch {
      /* a throwing callback must not break delivery */
    }
  }

  /** Context + super properties merged under the event's own; undefined when `beforeSend` dropped it. */
  private build(i: CaptureInput): WireEvent | undefined {
    const ctx = getContext();
    const personless = i.processPersonProfile === false;
    const distinctId = i.distinctId ?? ctx?.distinctId ?? (personless ? uuidv7() : undefined);
    if (!distinctId) throw new Error("distinctId is required (pass one, or run inside withContext)");
    const properties: Props = {
      ...this.superProps,
      ...(this.cfg.isServer ? { $is_server: true } : {}),
      ...ctx?.properties,
      ...(ctx?.sessionId ? { $session_id: ctx.sessionId } : {}),
      ...i.properties,
      ...(personless ? { $process_person_profile: false } : {}),
      ...((i.disableGeoip ?? this.cfg.disableGeoip) ? { $geoip_disable: true } : {}),
      $lib: LIB,
      $lib_version: LIB_VERSION,
    };
    const e: WireEvent = {
      uuid: i.uuid ?? uuidv7(),
      event: i.event,
      distinct_id: distinctId,
      timestamp: iso(i.timestamp),
      properties,
      ...(i.$set && !personless ? { $set: i.$set } : {}),
      ...(i.$set_once && !personless ? { $set_once: i.$set_once } : {}),
      ...(i.groups ? { $groups: i.groups } : {}),
    };
    if (!this.cfg.beforeSend) return e;
    try {
      return this.cfg.beforeSend(e) ?? undefined;
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)), [e]);
      return e; // a throwing hook keeps the original event
    }
  }

  capture(i: CaptureInput): void {
    if (this.off) return;
    const { flags: snap, sendFeatureFlags: send, ...rest } = i;
    if (snap) return this.capture({ ...rest, properties: withFlagProps(i.properties, snap.values as Record<string, FlagValue>) });
    const id = i.distinctId ?? getContext()?.distinctId;
    if (send && id) {
      const fo = typeof send === "object" ? send : {};
      const fo2: FlagOptions = { ...(i.groups ? { groups: i.groups } : {}), ...fo };
      const local = this.flags.localValues(id, fo2);
      if (local) return this.capture({ ...rest, distinctId: id, properties: withFlagProps(i.properties, local) });
      // shortcut: the event is queued after the flags request, so it may land behind later captures (ordering is by timestamp)
      const at = i.timestamp ?? new Date();
      void this.flags
        .all(id, fo2)
        .then((r) => r.flags, () => ({}))
        .then((v) => this.capture({ ...rest, distinctId: id, timestamp: at, properties: withFlagProps(i.properties, v) }));
      return;
    }
    const e = this.build(rest);
    if (!e) return;
    if (this.test) this.captured.push(e);
    else this.queue.enqueue(e);
  }

  /** Deliver one event now (one attempt; serverless). Resolves with its uuid, or undefined when dropped or failed. */
  async captureImmediate(i: CaptureInput): Promise<string | undefined> {
    if (this.off) return undefined;
    const e = this.build(i);
    if (!e) return undefined;
    if (this.test) {
      this.captured.push(e);
      return e.uuid;
    }
    const body = JSON.stringify({ api_key: this.apiKey, batch: [e], sent_at: new Date().toISOString() });
    const attempts = this.cfg.immediateAttempts ?? 3;
    let status = 0;
    for (let n = 0; n < attempts; n++) {
      ({ status } = await this.transport.send(`${this.host}/v1/batch`, body).catch(() => ({ status: 0 })));
      if (status >= 200 && status < 300) return e.uuid;
      if (!isRetryable(status) || n === attempts - 1) break;
      await new Promise((r) => setTimeout(r, backoffDelay(n, { baseMs: this.cfg.immediateRetryDelayMs ?? 200, maxMs: 2000 })));
    }
    this.fail(new Error(`event not delivered: status ${status}`), [e]);
    return undefined;
  }

  /** Client-wide default properties (context and per-event properties win). */
  register(properties: Props): void {
    Object.assign(this.superProps, properties);
  }

  unregister(key: string): void {
    delete this.superProps[key];
  }

  /** True the first time this exact call (kind + id + props) is seen in the process. */
  private firstIdentity(...parts: unknown[]): boolean {
    return this.sentIdentities.add(createHash("sha256").update(JSON.stringify(parts)).digest("hex"));
  }

  /** Set person properties via a `$set` event. */
  setPersonProperties(i: { distinctId?: string; properties: Props }): void {
    this.capture({ ...(i.distinctId ? { distinctId: i.distinctId } : {}), event: "$set", $set: i.properties });
  }

  /** Set person properties only where unset. */
  setPersonPropertiesOnce(i: { distinctId?: string; properties: Props }): void {
    this.capture({ ...(i.distinctId ? { distinctId: i.distinctId } : {}), event: "$set", $set_once: i.properties });
  }

  /** `$identify`; an identical call (same id and properties) already sent in this process is skipped. */
  identify(i: { distinctId?: string; properties?: Props; propertiesSetOnce?: Props }): void {
    if (!this.firstIdentity("identify", i.distinctId ?? getContext()?.distinctId, i.properties, i.propertiesSetOnce)) return;
    this.capture({
      ...(i.distinctId ? { distinctId: i.distinctId } : {}),
      event: "$identify",
      ...(i.properties ? { $set: i.properties } : {}),
      ...(i.propertiesSetOnce ? { $set_once: i.propertiesSetOnce } : {}),
    });
  }

  /** Link `alias` to `distinctId`. */
  alias(i: { distinctId?: string; alias: string }): void {
    const distinctId = i.distinctId ?? getContext()?.distinctId;
    if (!distinctId) throw new Error("distinctId is required (pass one, or run inside withContext)");
    this.capture({ distinctId, event: "$create_alias", properties: { alias: i.alias, distinct_id: distinctId } });
  }

  groupIdentify(i: { groupType: string; groupKey: string; properties?: Props; distinctId?: string }): void {
    if (!this.firstIdentity("group", i.groupType, i.groupKey, i.distinctId, i.properties)) return;
    this.capture({
      distinctId: i.distinctId ?? `$${i.groupType}_${i.groupKey}`,
      event: "$groupidentify",
      properties: { $group_type: i.groupType, $group_key: i.groupKey, $group_set: i.properties ?? {} },
    });
  }

  getFeatureFlag(key: string, distinctId: string, o?: FlagOptions): Promise<FlagValue | undefined> {
    return this.off ? Promise.resolve(undefined) : this.flags.get(key, distinctId, o);
  }

  async isFeatureEnabled(key: string, distinctId: string, o?: FlagOptions): Promise<boolean | undefined> {
    const v = await this.getFeatureFlag(key, distinctId, o);
    return v === undefined ? undefined : v !== false;
  }

  getFeatureFlagPayload(key: string, distinctId: string, o?: FlagOptions): Promise<unknown> {
    return this.off ? Promise.resolve(undefined) : this.flags.payload(key, distinctId, o);
  }

  async getAllFlags(distinctId: string, o?: FlagOptions): Promise<Record<string, FlagValue>> {
    return this.off ? {} : (await this.flags.all(distinctId, o)).flags;
  }

  /**
   * Evaluate every flag for `distinctId` once; read the snapshot as often as needed (no network, no exposure
   * events) and pass it to `capture({flags})`. `snapshot.onlyAccessed()` attaches just the flags the request read.
   */
  async evaluateFlags(distinctId: string, o?: FlagOptions): Promise<FlagSnapshot> {
    if (this.off) return new FlagSnapshot({});
    const r = await this.flags.all(distinctId, o);
    return new FlagSnapshot(r.flags, r.payloads);
  }

  /** Values and payloads of every flag for a user in one call; payloads holds only flags that have one. */
  async getAllFlagsAndPayloads(
    distinctId: string,
    o?: FlagOptions,
  ): Promise<{ flags: Record<string, FlagValue>; payloads: Record<string, unknown> }> {
    return this.off ? { flags: {}, payloads: {} } : this.flags.all(distinctId, o);
  }

  /**
   * Payload of a remote-config flag, decrypted when stored encrypted (the server opens those for secret keys only).
   * Needs `secretKey`; undefined when the flag is unknown or the call fails.
   */
  getRemoteConfigPayload(key: string): Promise<unknown> {
    if (!this.secretKey) throw new Error("getRemoteConfigPayload requires secretKey");
    return this.off ? Promise.resolve(undefined) : this.flags.remoteConfig(key, this.secretKey);
  }

  /** Reload flag definitions now (also runs on the polling interval). */
  reloadFeatureFlags(): Promise<void> {
    return this.poller?.load() ?? Promise.resolve();
  }

  flush(): Promise<void> {
    return this.queue.flush();
  }

  /** Stop polling, flush queued events, stop accepting new ones. */
  async shutdown(): Promise<void> {
    this.poller?.stop();
    await this.cfg.flagDefinitionCacheProvider?.shutdown?.();
    await this.queue.shutdown();
  }

  /**
   * Historical import via POST /v1/s2s/batch (secret key, timestamps preserved), chunks of 1000.
   * Throws on the first non-2xx chunk; resolves with the number of events accepted.
   */
  async importEvents(events: ImportEvent[]): Promise<number> {
    if (!this.secretKey) throw new Error("importEvents requires secretKey");
    if (this.off) return 0;
    if (this.test) {
      for (const e of events) this.capture(e);
      return events.length;
    }
    const transport = nodeTransport({
      fetch: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    let sent = 0;
    for (let i = 0; i < events.length; i += MAX_BATCH) {
      const batch = events.slice(i, i + MAX_BATCH).map((e) => ({
        uuid: e.uuid ?? uuidv7(),
        event: e.event,
        distinct_id: e.distinctId,
        timestamp: iso(e.timestamp),
        properties: { ...e.properties, $lib: LIB, $lib_version: LIB_VERSION },
        ...(e.$set ? { $set: e.$set } : {}),
        ...(e.$set_once ? { $set_once: e.$set_once } : {}),
      }));
      const body = JSON.stringify({ batch, sent_at: new Date().toISOString() });
      const { status } = await transport.send(`${this.host}/v1/s2s/batch`, body);
      if (status < 200 || status >= 300) throw new Error(`import failed: status ${status} after ${sent} events`);
      sent += batch.length;
    }
    return sent;
  }
}

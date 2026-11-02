import { evaluateAll, evaluateAllSticky, requiresServer, servable } from "@lucida-analytics/sdk-core";
import type { EvalContext, EvalResult, FlagDefinition, FlagValue, Props, StickyStore } from "@lucida-analytics/sdk-core";
import { LruSet } from "./lru.js";

export interface FlagOptions {
  personProperties?: Props;
  groups?: Record<string, string>;
  groupProperties?: Record<string, Props>;
  /** Context for `device` / `geo` / `app_version` filters and non-default bucketing (same names as the wire request). */
  deviceProperties?: Props;
  geoProperties?: Props;
  appVersion?: string;
  bucketingKey?: string;
  /** Id the person had before identify; remote evaluation keeps continuity flags in that bucket (LC-FLG-34). */
  anonDistinctId?: string;
  /** Bucketing unit for device-aggregated flags (local evaluation only). */
  deviceId?: string;
  /** Never call the server: undecidable flags (cohorts, unknown flags) yield undefined. */
  onlyEvaluateLocally?: boolean;
  /** Emit $feature_flag_called / $exposure (default true; getFeatureFlag only). */
  sendExposure?: boolean;
  /** App contexts this request declares (default: LucidaOptions.appContexts). */
  appContexts?: string[];
  /** getFeatureFlag returns this when nothing decides the flag (cold start, network error, unknown key). */
  defaultValue?: FlagValue;
}

interface Resolved {
  value: FlagValue;
  payload?: unknown;
  locally: boolean;
  requestId?: string;
  reason: string;
  conditionIndex: number;
}

/** A flag read with the evidence behind it (`getFeatureFlagDetails`). */
export interface FlagDetails {
  key: string;
  value: FlagValue;
  payload?: unknown;
  variant?: string;
  /** Raw Lucida reason ("condition_match", "kill_switch", ... or "fallback"). */
  reason: string;
  /** Deciding condition, -1 when none. */
  conditionIndex: number;
  requestId?: string;
  evaluatedLocally: boolean;
}

interface RemoteFlag {
  enabled?: boolean;
  variant?: string;
  value?: FlagValue;
  payload?: unknown;
  reason?: string;
  condition_index?: number;
}

export interface FlagsDeps {
  /** Anything exposing the current definitions (the poller, or a fixed list in testMode). */
  poller: { defs: FlagDefinition[] | undefined } | undefined;
  host: string;
  apiKey: string;
  fetch: typeof fetch;
  timeoutMs: number;
  /** Entries kept for `$feature_flag_called` dedup (default 10 000). */
  dedupCacheSize?: number;
  log: (...a: unknown[]) => void;
  capture: (distinctId: string, event: string, props: Props) => void;
  /** Sticky-bucketing store for local evaluation (LC-EXT-29). */
  sticky?: StickyStore;
  /** App contexts declared when a call passes none. */
  appContexts?: string[];
  /** Served (reason "fallback", no exposure) when nothing decides a flag. */
  fallbacks?: Record<string, FlagValue>;
}

const ctxOf = (id: string, o: FlagOptions): EvalContext => ({
  distinct_id: id,
  ...(o.groups ? { groups: o.groups } : {}),
  ...(o.personProperties ? { person_properties: o.personProperties } : {}),
  ...(o.groupProperties ? { group_properties: o.groupProperties } : {}),
  ...(o.deviceProperties ? { device_properties: o.deviceProperties } : {}),
  ...(o.geoProperties ? { geo_properties: o.geoProperties } : {}),
  ...(o.appVersion ? { app_version: o.appVersion } : {}),
  ...(o.bucketingKey ? { bucketing_key: o.bucketingKey } : {}),
  ...(o.deviceId ? { device_id: o.deviceId } : {}),
  ...(o.appContexts?.length ? { app_contexts: o.appContexts } : {}),
});

/** Server-side flag reads: local evaluation first, remote POST /v1/flags for what it cannot decide. */
export class ServerFlags {
  private readonly seen: LruSet;

  constructor(private readonly d: FlagsDeps) {
    this.seen = new LruSet(d.dedupCacheSize ?? 10_000);
  }

  private opts(o: FlagOptions): FlagOptions {
    return o.appContexts || !this.d.appContexts ? o : { ...o, appContexts: this.d.appContexts };
  }

  private async remote(id: string, o: FlagOptions, keys?: string[]): Promise<Map<string, Resolved>> {
    const out = new Map<string, Resolved>();
    try {
      const r = await this.d.fetch(`${this.d.host}/v1/flags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(this.d.timeoutMs),
        body: JSON.stringify({
          api_key: this.d.apiKey,
          distinct_id: id,
          ...(o.anonDistinctId ? { anon_distinct_id: o.anonDistinctId } : {}),
          groups: o.groups ?? {},
          person_properties: o.personProperties ?? {},
          group_properties: o.groupProperties ?? {},
          ...(o.deviceProperties ? { device_properties: o.deviceProperties } : {}),
          ...(o.geoProperties ? { geo_properties: o.geoProperties } : {}),
          ...(o.appVersion ? { app_version: o.appVersion } : {}),
          ...(o.bucketingKey ? { bucketing_key: o.bucketingKey } : {}),
          ...(keys ? { flag_keys: keys } : {}),
          ...(o.appContexts?.length ? { app_contexts: o.appContexts } : {}),
        }),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = (await r.json()) as { flags?: Record<string, RemoteFlag>; request_id?: string; quota_limited?: boolean };
      if (j.quota_limited) this.d.log("flags quota limited");
      for (const [k, f] of Object.entries(j.flags ?? {})) {
        out.set(k, {
          value: f.value ?? f.variant ?? !!f.enabled,
          payload: f.payload,
          locally: false,
          reason: f.reason ?? "",
          conditionIndex: f.condition_index ?? -1,
          ...(j.request_id ? { requestId: j.request_id } : {}),
        });
      }
    } catch (e) {
      this.d.log("remote flags failed", e);
    }
    return out;
  }

  private local(id: string, o: FlagOptions): Record<string, EvalResult> | undefined {
    const defs = this.d.poller?.defs;
    if (!defs) return undefined;
    const all = this.d.sticky ? evaluateAllSticky(defs, ctxOf(id, o), this.d.sticky) : evaluateAll(defs, ctxOf(id, o));
    return Object.fromEntries(Object.entries(all).filter(([, r]) => servable(r)));
  }

  /** Values decided locally right now (no network); undefined until definitions are loaded. */
  localValues(id: string, o: FlagOptions = {}): Record<string, FlagValue> | undefined {
    const loc = this.local(id, this.opts(o));
    if (!loc) return undefined;
    return Object.fromEntries(Object.entries(loc).filter(([, r]) => !requiresServer(r)).map(([k, r]) => [k, r.value]));
  }

  private async resolve(key: string, id: string, o: FlagOptions): Promise<Resolved | undefined> {
    o = this.opts(o);
    const r = this.local(id, o)?.[key];
    if (r && !requiresServer(r)) return { value: r.value, payload: r.payload, locally: true, reason: r.reason, conditionIndex: r.condition_index };
    const served = o.onlyEvaluateLocally ? undefined : (await this.remote(id, o, [key])).get(key);
    if (served) return served;
    const fb = this.d.fallbacks;
    return fb && Object.hasOwn(fb, key) ? { value: fb[key]!, locally: true, reason: "fallback", conditionIndex: -1 } : undefined;
  }

  private expose(key: string, id: string, r: Resolved): void {
    if (r.reason === "fallback" || !this.seen.add(`${id}\0${key}\0${String(r.value)}`)) return;
    const props: Props = {
      $feature_flag: key,
      $feature_flag_response: r.value,
      locally_evaluated: r.locally,
      ...(r.requestId ? { $feature_flag_request_id: r.requestId } : {}),
    };
    this.d.capture(id, "$feature_flag_called", props);
    this.d.capture(id, "$exposure", props);
  }

  async get(key: string, id: string, o: FlagOptions = {}): Promise<FlagValue | undefined> {
    const r = await this.resolve(key, id, o);
    if (r && o.sendExposure !== false) this.expose(key, id, r);
    return r?.value ?? o.defaultValue;
  }

  /** `get` with payload, variant, reason and provenance; same exposure rules. undefined when nothing decides the flag. */
  async details(key: string, id: string, o: FlagOptions = {}): Promise<FlagDetails | undefined> {
    const r = await this.resolve(key, id, o);
    if (!r) return undefined;
    if (o.sendExposure !== false) this.expose(key, id, r);
    return {
      key,
      value: r.value,
      ...(r.payload !== undefined ? { payload: r.payload } : {}),
      ...(typeof r.value === "string" ? { variant: r.value } : {}),
      reason: r.reason,
      conditionIndex: r.conditionIndex,
      ...(r.requestId ? { requestId: r.requestId } : {}),
      evaluatedLocally: r.locally,
    };
  }

  /** Payload of a remote-config flag; the server opens encrypted payloads for secret keys only. */
  async remoteConfig(key: string, secretKey: string): Promise<unknown> {
    try {
      const r = await this.d.fetch(`${this.d.host}/v1/flags/${encodeURIComponent(key)}/remote-config`, {
        headers: { Authorization: `Bearer ${secretKey}` },
        signal: AbortSignal.timeout(this.d.timeoutMs),
      });
      if (r.status === 404) return undefined; // unknown key or not a remote-config flag
      if (!r.ok) throw new Error(`status ${r.status}`);
      return ((await r.json()) as { payload?: unknown }).payload;
    } catch (e) {
      this.d.log("remote config failed", e);
      return undefined;
    }
  }

  async payload(key: string, id: string, o: FlagOptions = {}): Promise<unknown> {
    return (await this.resolve(key, id, o))?.payload;
  }

  async all(id: string, o: FlagOptions = {}): Promise<{ flags: Record<string, FlagValue>; payloads: Record<string, unknown> }> {
    o = this.opts(o);
    const loc = this.local(id, o);
    const res = new Map<string, Resolved>();
    for (const [k, r] of Object.entries(loc ?? {})) {
      if (!requiresServer(r)) res.set(k, { value: r.value, payload: r.payload, locally: true, reason: r.reason, conditionIndex: r.condition_index });
    }
    const undecided = !loc || Object.values(loc).some(requiresServer);
    if (undecided && !o.onlyEvaluateLocally) {
      for (const [k, r] of await this.remote(id, o)) if (!res.has(k)) res.set(k, r);
    }
    const flags: Record<string, FlagValue> = {};
    const payloads: Record<string, unknown> = {};
    for (const [k, r] of res) {
      flags[k] = r.value;
      if (r.payload !== undefined) payloads[k] = r.payload;
    }
    return { flags, payloads };
  }
}

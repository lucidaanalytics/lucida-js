import { FlagFreshness, evaluateAll, flagResult, requiresServer, servable, startFlagSync } from "@lucida/sdk-core";
import type { Core, EvalContext, FlagDefinition, FlagResult, Props } from "@lucida/sdk-core";
import type { AppStateLike } from "./adapters.js";
import type { FlagOptions } from "./types.js";
import type { FlagValue } from "./types.js";

const CACHE_KEY = "lc_flags";

/** Shape of go/gateway POST /v1/flags: per-flag objects; payload is per flag. */
interface FlagOut {
  enabled?: boolean;
  variant?: string;
  value?: FlagValue;
  payload?: unknown;
  reason?: string;
}

export interface FlagsDeps {
  core: Core;
  fetch: typeof fetch;
  apiHost: string;
  apiKey: string;
  whenConsented(fn: () => void): void;
  localFlags?: FlagDefinition[] | undefined;
  localFlagsContext?: Partial<EvalContext> | undefined;
  /** Subscribe to /v1/flags/stream (public key) and refetch on a change notice; polls while it is down. */
  flagStream?: boolean | { pollMs?: number } | undefined;
  /** Pauses the stream and polling while the app is not active. */
  appState?: AppStateLike | undefined;
  options?: FlagOptions | undefined;
  /** Never call POST /v1/flags: values come from `bootstrap`, `localFlags` and `updateFlags` only. */
  disableRemote?: boolean | undefined;
  /** Default person properties for flag requests ($app_version, $os, $lib); off with sendDefaultFlagProps false. */
  defaultProps?: Props | undefined;
}

export interface FlagsService {
  get(key: string): FlagValue | undefined;
  payload(key: string): unknown;
  /** Value, variant, payload and reason of one flag; records the exposure unless `sendExposure` is false. */
  result(key: string, o?: { sendExposure?: boolean }): FlagResult;
  onChange(cb: (f: Record<string, FlagValue>) => void): () => void;
  reload(): Promise<void>;
  /** Injects server-evaluated flags (own backend). `merge: true` keeps existing values. Notifies `onChange` subscribers. */
  update(flags: Record<string, FlagValue>, payloads?: Record<string, unknown>, o?: { merge?: boolean }): void;
  /** Person / group properties used only to evaluate flags (no `$set` event, so no ingestion race). */
  setPersonProperties(props: Record<string, unknown>, reload?: boolean): Promise<void>;
  resetPersonProperties(reload?: boolean): Promise<void>;
  setGroupProperties(type: string, props: Record<string, unknown>, reload?: boolean): Promise<void>;
  resetGroupProperties(reload?: boolean): Promise<void>;
  /** Every known value (overrides applied), without exposure events. */
  all(): Record<string, FlagValue>;
  /** Values forced on this device that win over the server; `false` clears. */
  override(map: Record<string, FlagValue> | false): void;
  /** Stops the change stream (client shutdown). */
  stop(): void;
}

const norm = (v: FlagOut | FlagValue): FlagValue => (typeof v === "object" ? (v.value ?? v.variant ?? !!v.enabled) : v);

/**
 * Flags: last cached response, then on-device evaluation (sdk-core, shared vectors), then
 * POST /v1/flags for what needs the server. Reads record `$feature_flag_called` once per
 * (flag, value) and `$exposure` once per flag per session.
 */
export function createFlags(d: FlagsDeps): FlagsService {
  const { core } = d;
  let values: Record<string, FlagValue> = {};
  let payloads: Record<string, unknown> = {};
  // Where each value came from (evaluator or server reason, "cached", "bootstrap", "pushed"); read by getFlagResult.
  let reasons: Record<string, string> = {};
  const fresh = new FlagFreshness(d.options?.cacheTtlMs);
  let requestId: string | undefined;
  let loaded = false;
  let seq = 0;
  const called = new Set<string>();
  const exposed = new Set<string>();
  let calledSession = "";
  const subs = new Set<(f: Record<string, FlagValue>) => void>();
  let overrides: Record<string, FlagValue> = {};
  const merged = (): Record<string, FlagValue> => ({ ...values, ...overrides });

  const apply = (v: Record<string, FlagValue>, p: Record<string, unknown>): void => {
    values = v;
    payloads = p;
    loaded = true;
    for (const s of subs) s(merged());
  };

  try {
    const c = JSON.parse(core.storage.get(CACHE_KEY) ?? "null") as { values: typeof values; payloads: typeof payloads; at?: number; id?: string } | null;
    if (c) {
      ({ values, payloads } = c);
      reasons = Object.fromEntries(Object.keys(values).map((k) => [k, "cached"]));
      fresh.restore(c);
    }
  } catch {
    /* ignore corrupt cache */
  }
  if (d.options?.bootstrap) {
    // Bootstrap wins over the cache until the first reload replaces it.
    values = { ...values, ...d.options.bootstrap.flags };
    payloads = { ...payloads, ...d.options.bootstrap.payloads };
    for (const k of Object.keys(d.options.bootstrap.flags ?? {})) reasons[k] = "bootstrap";
  }
  let personProps: Record<string, unknown> = {};
  let groupProps: Record<string, Record<string, unknown>> = {};
  const contexts = d.options?.evaluationContexts ?? [];
  const appContexts = contexts.length ? { app_contexts: contexts } : {};
  const flagPersonProps = (): Props => ({ ...d.defaultProps, ...personProps });
  const sendEvents = d.options?.sendFeatureFlagEvent !== false;

  let localV: Record<string, FlagValue> = {};
  /** Returns true when the server must still be asked. */
  const evalLocal = (): boolean => {
    if (!d.localFlags?.length) return true;
    const res = evaluateAll(d.localFlags, {
      distinct_id: core.distinctId,
      ...(core.groups ? { groups: core.groups } : {}),
      ...(Object.keys(groupProps).length ? { group_properties: groupProps } : {}),
      ...appContexts,
      ...d.localFlagsContext,
      person_properties: { ...flagPersonProps(), ...d.localFlagsContext?.person_properties },
    });
    const v: Record<string, FlagValue> = {};
    const p: Record<string, unknown> = {};
    let server = false;
    for (const [k, r] of Object.entries(res)) {
      if (requiresServer(r)) server = true;
      else if (servable(r)) {
        v[k] = r.value;
        reasons[k] = r.reason;
        if (r.payload !== undefined) p[k] = r.payload;
      }
    }
    localV = v;
    apply({ ...values, ...v }, { ...payloads, ...p });
    return server;
  };

  /** `force=false` honours `flagOptions.cacheTtlMs`: no request while the last response for this id is fresh. */
  const reload = (force = true): Promise<void> => {
    const mine = ++seq;
    if (!evalLocal() || d.disableRemote) return Promise.resolve(); // local evaluation needs no network
    if (!force && fresh.fresh(core.distinctId)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      d.whenConsented(() => {
        if (mine !== seq) return resolve();
        d.fetch(`${d.apiHost}/v1/flags`, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ api_key: d.apiKey, ...(core.distinctId ? { distinct_id: core.distinctId } : {}),
            ...(core.anonDistinctId ? { anon_distinct_id: core.anonDistinctId } : {}), groups: core.groups ?? {},
            person_properties: flagPersonProps(),
            ...(Object.keys(groupProps).length ? { group_properties: groupProps } : {}),
            ...(d.defaultProps?.$app_version ? { app_version: d.defaultProps.$app_version } : {}),
            ...appContexts,
          }),
        })
          .then((r) => (r.ok ? (r.json() as Promise<{ flags?: Record<string, FlagOut | FlagValue>; request_id?: string; quota_limited?: boolean }>) : Promise.reject(new Error(`status ${r.status}`))))
          .then((j) => {
            if (mine !== seq || j.quota_limited) return; // quota limited: keep cached values
            const v: Record<string, FlagValue> = {};
            const p: Record<string, unknown> = {};
            for (const [k, x] of Object.entries(j.flags ?? {})) {
              v[k] = norm(x);
              if (typeof x === "object" && x.payload !== undefined) p[k] = x.payload;
              reasons[k] = typeof x === "object" && typeof x.reason === "string" ? x.reason : "remote";
            }
            requestId = j.request_id;
            apply({ ...localV, ...v }, p);
            core.storage.set(CACHE_KEY, JSON.stringify({ values: v, payloads: p, ...fresh.mark(core.distinctId) }));
          })
          .catch(() => undefined) // keep cached/local values
          .finally(resolve);
      });
    });
  };

  if (d.options?.preload !== false) {
    core.onChange((c) => {
      if (c === "reset") personProps = {};
      if (c === "identify" || c === "reset" || c === "group") void reload();
    });
    void reload(false);
  }

  let stopSync: (() => void) | undefined;
  const fs = d.flagStream;
  if (fs && !d.disableRemote) {
    const app = d.appState;
    d.whenConsented(() => {
      stopSync = startFlagSync({
        apiHost: d.apiHost,
        apiKey: d.apiKey,
        fetch: d.fetch,
        reload: () => void reload(),
        ...(typeof fs === "object" && fs.pollMs !== undefined ? { pollMs: fs.pollMs } : {}),
        ...(app
          ? {
              visibility: {
                hidden: () => app.currentState !== undefined && app.currentState !== "active",
                subscribe: (cb: () => void) => {
                  const sub = app.addEventListener("change", cb);
                  return () => sub.remove();
                },
              },
            }
          : {}),
      });
    });
  }

  return {
    stop: () => stopSync?.(),
    get(key) {
      const v = overrides[key] ?? values[key];
      if (v === undefined) return undefined;
      if (key in overrides) return v; // an override is not an exposure
      const sid = core.sessionId;
      if (sid !== calledSession) {
        called.clear();
        exposed.clear();
        calledSession = sid;
      }
      if (!sendEvents) return v;
      if (!exposed.has(key)) {
        exposed.add(key);
        core.capture("$exposure", {
          $feature_flag: key,
          $feature_flag_response: v,
          ...(typeof v === "string" ? { $feature_flag_variant: v } : {}),
          ...(requestId ? { $feature_flag_request_id: requestId } : {}),
        });
      }
      const dedupe = `${key}:${String(v)}`;
      if (!called.has(dedupe)) {
        called.add(dedupe);
        core.capture("$feature_flag_called", {
          $feature_flag: key,
          $feature_flag_response: v,
          ...(requestId ? { $feature_flag_request_id: requestId } : {}),
        });
      }
      return v;
    },
    payload: (key) => payloads[key],
    result(key, o) {
      const v = o?.sendExposure === false ? overrides[key] ?? values[key] : this.get(key);
      return flagResult(key, v, payloads[key], key in overrides ? "override" : (reasons[key] ?? "remote"));
    },
    update(flags, p = {}, o = {}) {
      for (const k of Object.keys(flags)) reasons[k] = "pushed";
      apply(o.merge ? { ...values, ...flags } : { ...flags }, o.merge ? { ...payloads, ...p } : { ...p });
      core.storage.set(CACHE_KEY, JSON.stringify({ values, payloads }));
    },
    async setPersonProperties(props, doReload = true) {
      fresh.clear();
      personProps = { ...personProps, ...props };
      if (doReload) await reload();
    },
    async resetPersonProperties(doReload = true) {
      personProps = {};
      if (doReload) await reload();
    },
    async setGroupProperties(type, props, doReload = true) {
      fresh.clear();
      groupProps = { ...groupProps, [type]: { ...groupProps[type], ...props } };
      if (doReload) await reload();
    },
    async resetGroupProperties(doReload = true) {
      groupProps = {};
      if (doReload) await reload();
    },
    onChange(cb) {
      subs.add(cb);
      if (loaded) cb(merged());
      return () => void subs.delete(cb);
    },
    reload,
    all: () => merged(),
    override(map) {
      overrides = map ? { ...map } : {};
      for (const s of subs) s(merged());
    },
  };
}

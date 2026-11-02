import { FlagFreshness, evaluateAll, flagResult, requiresServer, servable, startFlagSync } from "@lucida/sdk-core";
import type { EvalResult, Props } from "@lucida/sdk-core";
import type { FlagContextKind, FlagValue, Host, Module } from "../types.js";
import { readPreview } from "./preview.js";
import { flagAutoProps, flagDeviceProps, flagWebProps } from "./request-props.js";
import { hasEventFilters, norm, runtimeTargeting, toEvalResult } from "./runtime.js";
import type { FlagOut } from "./runtime.js";

const CACHE_KEY = "lc_flags";
const OVERRIDE_KEY = "lc_flag_overrides_api";
interface FlagsResponse {
  flags?: Record<string, FlagOut | FlagValue>;
  request_id?: string;
  /** Plan quota exhausted: nothing was evaluated, keep what we have. */
  quota_limited?: boolean;
}

/** Flag overrides set from the toolbar (same key as toolbar/api.ts). */
function toolbarOverride(key: string): FlagValue | undefined {
  try {
    const raw = localStorage.getItem("lc_flag_overrides");
    return raw ? (JSON.parse(raw) as Record<string, FlagValue>)[key] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Flags module: values come from bootstrap, then the last cached response, then POST /v1/flags
 * (re-fetched on identify/reset/group). $feature_flag_called fires once per (flag, value, session).
 * In opt_in mode nothing is fetched or cached before consent. A QA link (`?lc_preview=flag:variant`,
 * LC-EXT-34) asks the gateway for that variant and its payload; previewed flags record no exposure.
 * `flagOptions.disableRemote` never requests flags; `disableFlagsOnFirstLoad` skips only the request at init.
 */
export const flags: Module = (host: Host) => {
  const { core, config } = host;
  let values: Record<string, FlagValue> = {};
  let payloads: Record<string, unknown> = {};
  // Where each value came from (evaluator or server reason, "cached", "bootstrap", "pushed"); read by getFlagResult.
  let reasons: Record<string, string> = {};
  let requestId: string | undefined;
  let loaded = false;
  let seq = 0;
  const called = new Set<string>();
  const exposed = new Set<string>();
  let calledSession = "";
  // Multi-kind flag contexts: memory only, so nothing is persisted or sent before the consent-gated request.
  let contexts: Partial<Record<FlagContextKind, { key: string; properties: Record<string, unknown> }>> = {};
  const hasContexts = () => Object.keys(contexts).length > 0;
  let personOverride: Props = {};
  let groupOverride: Record<string, Props> = {};
  let overrides: Record<string, FlagValue> = {};
  const subs = new Set<(f: Record<string, FlagValue>) => void>();
  const preview = typeof location === "undefined" ? { forced: {}, persist() {} } : readPreview(location.href);
  const previewing = Object.keys(preview.forced).length > 0;

  const merged = (): Record<string, FlagValue> => ({ ...values, ...overrides });
  const opts = host.config.flagOptions ?? {};
  const fresh = new FlagFreshness(opts.cacheTtlMs);
  const flagsHost = (host.config.flagsApiHost ?? host.config.apiHost).replace(/\/+$/, "");
  const wanted = opts.keys?.length ? new Set(opts.keys) : undefined;
  const scope = <T,>(m: Record<string, T>): Record<string, T> =>
    wanted ? Object.fromEntries(Object.entries(m).filter(([k]) => wanted.has(k))) : m;

  const apply = (v: Record<string, FlagValue>, p: Record<string, unknown>, notify = true): void => {
    values = scope(v);
    payloads = scope(p);
    loaded = true;
    if (notify) for (const s of subs) s(merged());
  };
  const rt = runtimeTargeting(host, config.localFlags);

  const cached = host.flagStorage.get(CACHE_KEY);
  if (cached) {
    try {
      const c = JSON.parse(cached) as { values: Record<string, FlagValue>; payloads: Record<string, unknown>; rt?: Record<string, EvalResult>; at?: number; id?: string };
      values = c.values;
      payloads = c.payloads;
      reasons = Object.fromEntries(Object.keys(values).map((k) => [k, "cached"]));
      if (c.rt) rt.setServer(c.rt);
      fresh.restore(c);
    } catch {
      /* ignore corrupt cache */
    }
  }
  const savedOverrides = host.flagStorage.get(OVERRIDE_KEY);
  if (savedOverrides) {
    try {
      overrides = JSON.parse(savedOverrides) as Record<string, FlagValue>;
    } catch {
      /* ignore corrupt overrides */
    }
  }
  const boot = config.bootstrap;
  if (boot?.flags) {
    apply({ ...boot.flags }, { ...boot.payloads });
    for (const k of Object.keys(boot.flags)) reasons[k] = "bootstrap";
  }

  // Local evaluation (config.localFlags): decides what it can in the browser with the sdk-core
  // evaluator; flags needing the server (cohorts) still go through POST /v1/flags.
  let localV: Record<string, FlagValue> = {};
  const personProps = (): Record<string, unknown> => ({
    ...(opts.autoProperties === false ? {} : flagAutoProps()),
    ...flagWebProps(core.storage, host.whenConsented),
    ...Object.assign({}, ...host.flagPersonProps.map((f) => f())),
    ...personOverride,
  });
  const appContexts = opts.evaluationContexts?.length ? { app_contexts: opts.evaluationContexts } : {};
  const evalLocal = (notify = true): boolean => {
    const defs = config.localFlags;
    if (!defs?.length) return true;
    const ctx = config.localFlagsContext;
    const res = evaluateAll(defs, {
      runtime_events: rt.counts(), // event filters (P-H6) are decided here, on this browser's counts
      distinct_id: core.distinctId,
      ...(core.groups ? { groups: core.groups } : {}),
      ...(core.deviceId ? { device_id: core.deviceId } : {}),
      ...(hasContexts() ? { contexts } : {}),
      ...appContexts,
      ...ctx,
      person_properties: { ...personProps(), ...ctx?.person_properties },
      group_properties: { ...ctx?.group_properties, ...groupOverride },
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
    apply({ ...values, ...v }, { ...payloads, ...p }, notify);
    return server;
  };

  /** Server results with event branches, resolved on the current counts, folded into the flag set. */
  const applyRuntime = (notify: boolean): void => {
    const v = { ...values };
    const p = { ...payloads };
    for (const [k, r] of Object.entries(rt.resolved())) {
      v[k] = r.value;
      reasons[k] = r.reason;
      if (r.payload !== undefined) p[k] = r.payload;
      else delete p[k];
    }
    apply(v, p, notify);
  };
  const localEvents = hasEventFilters(config.localFlags);
  // Every captured event updates the runtime counts; a flag whose value changes notifies once.
  host.onCapture((e) => {
    const watching = localEvents || Object.keys(rt.server()).length > 0;
    rt.record(e.event, e.properties, watching);
    if (!watching) return;
    const before = JSON.stringify([merged(), payloads]);
    if (localEvents) evalLocal(false);
    applyRuntime(false);
    if (JSON.stringify([merged(), payloads]) !== before) for (const s of subs) s(merged());
  });

  /** `force=false` honours `flagOptions.cacheTtlMs`: no request while the last response for this id is fresh. */
  const reload = (force = true): Promise<void> => {
    const mine = ++seq;
    if (!evalLocal() || opts.disableRemote) return Promise.resolve(); // local evaluation needs no network
    if (!force && fresh.fresh(core.distinctId)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      host.whenConsented(() => {
        if (mine !== seq) return resolve(); // superseded while waiting for consent
        preview.persist();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
        host
          .fetch(`${flagsHost}/v1/flags`, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            credentials: "omit",
            signal: ctl.signal,
            body: JSON.stringify({
              api_key: host.apiKey,
              ...(core.distinctId ? { distinct_id: core.distinctId } : {}),
              ...(core.anonDistinctId ? { anon_distinct_id: core.anonDistinctId } : {}),
              groups: core.groups ?? {},
              person_properties: personProps(),
              ...(Object.keys(groupOverride).length ? { group_properties: groupOverride } : {}),
              device_properties: flagDeviceProps(),
              ...(core.deviceId ? { device_id: core.deviceId } : {}),
              ...(hasContexts() ? { contexts } : {}),
              ...appContexts,
              ...(previewing ? { preview: preview.forced } : {}),
              ...(opts.keys?.length ? { flag_keys: opts.keys } : {}),
            }),
          })
          .then((r) => (r.ok ? (r.json() as Promise<FlagsResponse>) : Promise.reject(new Error(`status ${r.status}`))))
          .then((j) => {
            if (mine !== seq) return; // a newer request superseded this one
            if (j.quota_limited) return host.log("flags quota limited; keeping cached values");
            const v: Record<string, FlagValue> = {};
            const p: Record<string, unknown> = {};
            const branched: Record<string, EvalResult> = {};
            for (const [k, x] of Object.entries(j.flags ?? {})) {
              v[k] = norm(x);
              if (typeof x === "object" && x.payload !== undefined) p[k] = x.payload;
              reasons[k] = typeof x === "object" && typeof x.reason === "string" ? x.reason : "remote";
              if (typeof x === "object" && x.runtime?.length) branched[k] = toEvalResult(x);
            }
            requestId = j.request_id;
            rt.setServer(branched);
            apply({ ...localV, ...v }, p, false);
            applyRuntime(true);
            host.flagStorage.set(CACHE_KEY, JSON.stringify({ values: v, payloads: p, rt: branched, ...fresh.mark(core.distinctId) }));
            host.log("flags loaded", v);
          })
          .catch((e) => host.log("flags fetch failed", e))
          .finally(() => {
            clearTimeout(timer);
            resolve();
          });
      });
    });
  };

  const current = (key: string): FlagValue | undefined => overrides[key] ?? toolbarOverride(key) ?? values[key];

  host.flags = {
    get(key) {
      const v = current(key); // programmatic and toolbar overrides are local to this browser
      if (v === undefined) return undefined;
      if (key in preview.forced || key in overrides) return v; // a QA preview or override is not an exposure
      const sid = core.sessionId;
      if (sid !== calledSession) {
        called.clear();
        exposed.clear();
        calledSession = sid;
      }
      // $exposure: first read of a flag per session (experiment analysis uses exposed units only).
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
    all: () => (loaded || Object.keys(values).length || Object.keys(overrides).length ? merged() : {}),
    payload: (key) => payloads[key],
    result(key, o) {
      const v = o?.sendExposure === false ? current(key) : this.get(key);
      const source = key in overrides || toolbarOverride(key) !== undefined ? "override" : key in preview.forced ? "preview" : (reasons[key] ?? "remote");
      return flagResult(key, v, payloads[key], source);
    },
    layerParam(layer, param) {
      for (const [k, p] of Object.entries(payloads)) {
        const pl = p as { lc_layer?: unknown; lc_params?: Record<string, unknown> } | null;
        if (pl?.lc_layer !== layer || !pl.lc_params || !(param in pl.lc_params)) continue;
        const v = this.get(k); // the person's experiment in this layer: an exposure
        if (v !== undefined && v !== false) return pl.lc_params[param];
      }
      return undefined;
    },
    onChange(cb) {
      subs.add(cb);
      if (loaded) cb(merged());
      return () => void subs.delete(cb);
    },
    reload,
    update(f, p, merge = true) {
      for (const k of Object.keys(f)) reasons[k] = "pushed";
      rt.drop(Object.keys(f)); // a pushed value replaces the server's runtime branches
      apply(merge ? { ...values, ...f } : { ...f }, merge ? { ...payloads, ...p } : { ...p });
    },
    override(map, opts) {
      overrides = map ? { ...map } : {};
      if (!map) host.flagStorage.remove(OVERRIDE_KEY);
      else if (opts?.persist) host.whenConsented(() => host.flagStorage.set(OVERRIDE_KEY, JSON.stringify(overrides)));
      for (const s of subs) s(merged());
    },
    setPersonProperties(props, reloadNow = true) {
      fresh.clear();
      personOverride = { ...personOverride, ...props };
      if (reloadNow) void reload();
    },
    resetPersonProperties() {
      personOverride = {};
    },
    setGroupProperties(props, reloadNow = true) {
      fresh.clear();
      for (const [t, p] of Object.entries(props)) groupOverride[t] = { ...groupOverride[t], ...p };
      if (reloadNow) void reload();
    },
    resetGroupProperties() {
      groupOverride = {};
    },
    setContext(kind, key, properties) {
      fresh.clear();
      contexts = { ...contexts, [kind]: { key, properties: properties ?? {} } };
      void reload();
    },
    clearContext(kind) {
      fresh.clear();
      const { [kind]: _gone, ...rest } = contexts;
      contexts = rest;
      void reload();
    },
  };

  core.onChange((c) => {
    if (c === "reset") {
      contexts = {}; // the user is forgotten, and so are the contexts and overrides describing them
      personOverride = {};
      groupOverride = {};
    }
    if (c === "identify" || c === "reset" || c === "group") void reload();
  });
  if (config.disableFlagsOnFirstLoad) evalLocal();
  else void reload(false);

  // Opt-in change stream: a notice triggers a refetch for the current distinct id; polls while it is down.
  const fs = config.flagStream;
  let stopSync: (() => void) | undefined;
  if (fs && !opts.disableRemote) {
    host.whenConsented(() => {
      stopSync = startFlagSync({
        apiHost: flagsHost,
        apiKey: host.apiKey,
        fetch: host.fetch,
        reload: () => void reload(),
        visibility: {
          hidden: () => document.visibilityState === "hidden",
          subscribe: (cb) => {
            document.addEventListener("visibilitychange", cb);
            return () => document.removeEventListener("visibilitychange", cb);
          },
        },
        ...(typeof fs === "object" && fs.pollMs !== undefined ? { pollMs: fs.pollMs } : {}),
        log: host.log,
      });
    });
  }
  // Periodic refresh while the page is visible.
  const refresh = opts.refreshMs && opts.refreshMs > 0 && !opts.disableRemote
    ? setInterval(() => document.visibilityState !== "hidden" && void reload(false), opts.refreshMs)
    : undefined;
  return () => {
    stopSync?.();
    if (refresh) clearInterval(refresh);
  };
};

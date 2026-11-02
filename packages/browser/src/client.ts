import { AgentConversation, Core, GatedStorage, flagEventProps, flagResult, interventionHub, offlineTransport } from "@lucida/sdk-core";
import type { Props, Storage, Transport } from "@lucida/sdk-core";
import { isBotUserAgent } from "./bot-ua.js";
import { clickIdTracker } from "./clickids.js";
import { captureCspViolations, cspHint } from "./csp.js";
import { isExtensionPage, withRewrite } from "./delivery.js";
import { connectDevtools } from "./devtools-hook.js";
import { campaignKey, enrich } from "./env.js";
import { takeLinker } from "./linker.js";
import { installPolicy } from "./policy.js";
import { DebouncedStorage, WebStorageAdapter, createStorage, keySuffix } from "./storage.js";
import { browserTransport, noopTransport } from "./transport.js";
import type { BrowserConfig, Client, FlagsService, Host, Module, Persistence, RemoteConfig } from "./types.js";

export const LIB = "lucida-browser";
export const LIB_VERSION = "0.1.0";
const INTERNAL_KEY = "lc_internal";
/** Longest wait for the geo consent default (consent.geo) before the local mode applies. */
const GEO_WAIT_MS = 3000;
export const DEFAULT_HOST = "https://app.lucida.dev";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/** Build a client from the shared core plus the given modules (pass none for the smallest bundle). */
export function createClient(apiKey: string, config: BrowserConfig = {}, modules: Module[] = []): Client {
  let debugOn = !!config.debug || (typeof location !== "undefined" && /[?&]__(lc|lucida)_debug=(1|true)/.test(location.search));
  const log = (...a: unknown[]): void => {
    if (debugOn) console.debug("[lucida]", ...a);
  };
  const apiHost = (config.apiHost ?? DEFAULT_HOST).replace(/\/+$/, "");
  // One level copied so setConfig can merge nested options (autocapture, ...) in place without touching the caller's objects.
  const live = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, isObj(v) ? { ...v } : v])) as BrowserConfig & { apiHost: string };
  live.apiHost = apiHost;
  // Extension pages (MV3) get no cookies; remote code is refused in snippet.ts.
  const extension = config.extension ?? isExtensionPage();
  // `extensionPersistence` (default localStorage; "memory" keeps a content script out of the host page's storage).
  const mode = (p: Persistence): Persistence => (extension && (p === "cookie" || p === "localStorage+cookie") ? (config.extensionPersistence ?? "localStorage") : p);
  const persistence = mode(config.cookieless === "always" ? "none" : (config.persistence ?? "cookie"));
  const origins = [apiHost, ...(config.flagsApiHost ? [config.flagsApiHost.replace(/\/+$/, "")] : [])];
  const rawFetch = config.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const rewrite = (t: Transport) => withRewrite(t, rawFetch, origins, config.rewritePath);
  const fetchImpl = rewrite(noopTransport).fetch;
  // DNT / GPC only count when the page opted in; consent then starts denied (opt_out mode) and storage stays gated.
  const legacy = config.consent?.respectDnt;
  const gpc = (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const dnt = ((config.respectDnt ?? legacy) === true && navigator.doNotTrack === "1") || ((config.respectGpc ?? legacy) === true && gpc);
  // Known crawlers and headless browsers send nothing (no storage, no network); `blockBots: false` keeps them.
  const botUa = config.blockBots !== false && typeof navigator !== "undefined" && isBotUserAgent(navigator.userAgent ?? "");
  const disabled = !!config.disabled || botUa;
  if (botUa) log("bot user agent: capture disabled");

  // Default transport persists undeliverable batches (bounded) and replays them when back online.
  let offline: ReturnType<typeof offlineTransport> | undefined;
  let transport: Transport = rewrite(
    config.transport ?? browserTransport(rawFetch, { headers: live.requestHeaders, onError: config.onRequestError, disableBeacon: config.disableBeacon }),
  ).transport;
  if (!config.transport && config.offlineQueue !== false && persistence !== "memory" && persistence !== "none") {
    // Anonymous (cookielessOnReject) batches may be undeliverable too: they stay in memory, never in localStorage.
    const parked = new GatedStorage(new WebStorageAdapter(persistence === "sessionStorage" ? "sessionStorage" : "localStorage"), () => core.hasConsent("analytics"));
    transport = offline = offlineTransport(transport, parked, {
      key: `lc_offline${keySuffix(apiKey)}`,
      isOnline: () => navigator.onLine !== false,
    });
  }

  const linked = disabled ? undefined : takeLinker(config.crossDomains);
  const raw = createStorage(disabled ? "memory" : persistence, apiKey, config.cookie);
  const debounced = (config.storageWriteDelayMs ?? 0) > 0 ? new DebouncedStorage(raw, config.storageWriteDelayMs!) : undefined;
  const sessionBoot = linked?.sessionId ?? config.bootstrap?.sessionId;
  let flagsSvc: FlagsService | undefined; // read at capture time (modules run after the core exists)
  let internal = false;
  let clickIds: ReturnType<typeof clickIdTracker> | undefined;
  const eventExtras: Host["eventExtras"] = [];
  const core = new Core({
    apiKey,
    apiHost,
    transport: disabled ? noopTransport : transport,
    storage: debounced ?? raw,
    ...(config.consentPersistence && !disabled ? { consentStorage: createStorage(mode(config.consentPersistence), apiKey, config.cookie) } : {}),
    persistProperty: (k) => !live.persistedProperties || live.persistedProperties.includes(k),
    ...(persistence === "none" ? { cookieless: true } : {}),
    library: { name: LIB, version: LIB_VERSION },
    consent: {
      ...(config.cookieless === "on_reject" ? { cookielessOnReject: true } : {}),
      ...config.consent,
      ...(config.consent?.geo && !disabled ? { awaitRemote: true } : {}),
      respectDnt: true,
      dnt,
    },
    queue: {
      ...(config.flushAt ? { flushAt: config.flushAt } : {}),
      ...(config.flushIntervalMs ? { flushIntervalMs: config.flushIntervalMs } : {}),
    },
    ...(linked || config.bootstrap?.distinctId ? { bootstrapDistinctId: (linked?.distinctId ?? config.bootstrap?.distinctId) as string } : {}),
    ...(config.bootstrap?.isIdentified && !linked ? { bootstrapIdentified: true } : {}),
    session: { ...config.session, ...(sessionBoot ? { bootstrapId: sessionBoot } : {}) },
    enrich: (event, props) => {
      const e = enrich(event, props, live.customCampaignParams, config.capturePageview === "hash");
      // Proxy coverage: which events came through a custom ingest host.
      if (apiHost !== DEFAULT_HOST) e.properties = { ...e.properties, $lib_custom_api_host: apiHost };
      if (eventExtras.length) {
        const sid = core.sessionId;
        for (const x of eventExtras) e.properties = { ...e.properties, ...x(sid) };
      }
      const ids = clickIds?.() ?? {};
      const ks = Object.keys(ids);
      if (ks.length) {
        e.properties = { ...e.properties, $click_ids: ids };
        if (event === "$pageview") {
          // first-touch ($initial_*, set once) and last-touch ($last_*) person properties
          e.$set_once = { ...Object.fromEntries(ks.map((k) => [`$initial_${k}`, ids[k]])), ...e.$set_once };
          e.$set = Object.fromEntries(ks.map((k) => [`$last_${k}`, ids[k]]));
        }
      }
      if (live.sendFeatureFlags !== false && event !== "$snapshot" && flagsSvc) {
        e.properties = { ...flagEventProps(flagsSvc.all()), ...e.properties };
      }
      return internal ? { ...e, properties: { ...e.properties, $internal: true } } : e;
    },
    campaignKey,
    log,
  });

  // Worker filter (Rust lane) must drop or flag `$internal` events; `$lc_*` is stripped at the gateway so the SDK uses `$internal`.
  internal = core.storage.get(INTERNAL_KEY) === "1";
  if (config.clickIds !== false) clickIds = clickIdTracker(core.storage, config.clickIds?.expiryDays);

  const person = installPolicy(core, live, log);
  if (config.bootstrap?.isIdentified) person.markIdentified();
  const noPersons = (what: string): boolean => {
    if (!person.blocksPersonWrites) return false;
    log(`personProfiles=never: ${what} ignored`);
    return true;
  };

  const unload: Array<() => void> = [];
  const teardowns: Array<() => void> = [cspHint(log, config.nonce)];
  // A separate flag store is consent-gated like the core one, and released or dropped with the decision.
  let flagStorage: Storage = core.storage;
  if (config.flagPersistence && !disabled) {
    const gated = new GatedStorage(createStorage(mode(config.flagPersistence), apiKey, config.cookie), () => core.hasConsent("analytics"));
    core.onChange((c) => void (c === "consent" && (core.hasConsent("analytics") ? gated.flushBuffered() : gated.discardBuffered())));
    flagStorage = gated;
  }

  const whenConsented = (fn: () => void): void => {
    if (disabled) return;
    if (core.hasConsent("analytics")) return fn();
    let done = false;
    core.onChange((c) => {
      if (!done && c === "consent" && core.hasConsent("analytics")) {
        done = true;
        fn();
      }
    });
  };

  let cfg: Promise<RemoteConfig | null> | undefined;
  const host: Host = {
    core,
    client: undefined as unknown as Client, // set below, before modules run
    config: live,
    flagStorage,
    apiKey,
    log,
    fetch: fetchImpl,
    onUnload: (fn) => void unload.push(fn),
    whenConsented,
    onCapture: (fn) => core.onCaptured(fn),
    eventExtras,
    clickExtras: [],
    flagPersonProps: [],
    loadConfig: () =>
      (cfg ??= new Promise<RemoteConfig | null>((resolve) =>
        whenConsented(() => {
          fetchImpl(`${apiHost}/v1/config?api_key=${encodeURIComponent(apiKey)}`)
            .then((r) => (r.ok ? (r.json() as Promise<RemoteConfig>) : null))
            // shortcut: the session definition (N-ANA-6) applies when a module loads the config (autocapture, replay,
            // heatmaps, consent.geo); a core-only bundle keeps the local session options. Upgrade: an explicit boot fetch.
            .then((r) => {
              if (r) core.applyRemote(r);
              return r;
            })
            .then(resolve, () => resolve(null));
        }),
      )),
  };

  if (core.consent.resolving) {
    // Geo consent (N-ANA-17): the config is read before consent (one GET carrying only the public key) so the
    // project's rule applies before any write; past GEO_WAIT_MS the local mode applies and the answer only adds
    // the session definition. The same response serves loadConfig() later.
    const early = fetchImpl(`${apiHost}/v1/config?api_key=${encodeURIComponent(apiKey)}`, { credentials: "omit" })
      .then((r) => (r.ok ? (r.json() as Promise<RemoteConfig>) : null))
      .catch(() => null);
    cfg = early;
    const timer = setTimeout(() => core.applyRemote({}), GEO_WAIT_MS);
    void early.then((r) => {
      clearTimeout(timer);
      core.applyRemote(r ?? {});
    });
  }

  const interventions = interventionHub(core, { apiHost, apiKey, fetch: fetchImpl, whenConsented, log, disabled });
  teardowns.push(() => interventions.stop());
  const client: Client = {
    get distinctId() {
      return core.distinctId;
    },
    capture: (event, props, o) => {
      const sent = core.capture(event, props, o?.timestamp !== undefined ? { timestamp: o.timestamp } : {});
      if (sent && (o?.sendInstantly || o?.transport)) void core.flush(o.transport === "beacon" ? { beacon: true } : {});
    },
    identify: (id, set, once) => {
      if (noPersons("identify")) return;
      person.markIdentified();
      core.identify(id, set, once);
    },
    alias: (a, o) => {
      if (noPersons("alias")) return;
      person.markIdentified();
      core.alias(a, o);
    },
    reset: (resetDeviceId) => {
      core.reset({ resetDeviceId: !!resetDeviceId, reuseAnonymousId: !!config.reuseAnonymousId });
      person.reset();
    },
    createPersonProfile: () => {
      if (noPersons("createPersonProfile") || person.isProfile) return;
      person.markIdentified();
      core.capture("$set", {}); // carries the $set_once values kept while personless
    },
    setConfig: (p) => {
      const target = live as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(p)) {
        const cur = target[k];
        if (isObj(cur) && isObj(v)) Object.assign(cur, v);
        else target[k] = v;
      }
      if ("debug" in p) debugOn = !!p.debug;
    },
    setPersonProperties: (set, once) => {
      if ((!set && !once) || noPersons("setPersonProperties")) return;
      person.markIdentified();
      core.capture("$set", {}, { ...(set ? { $set: set } : {}), ...(once ? { $set_once: once } : {}) });
    },
    unsetPersonProperties: (keys) => {
      if (!keys.length || noPersons("unsetPersonProperties")) return;
      person.markIdentified();
      core.capture("$set", {}, { $unset: keys });
    },
    getSessionId: () => core.sessionId,
    onSessionId: (cb) => core.onSessionId((id) => cb(id)),
    getProperty: (k) => core.getProperty(k),
    hasOptedOut: () => !core.hasConsent("analytics"),
    getReplayUrl: (o) => {
      const base = (config.uiHost ?? apiHost).replace(/\/+$/, "");
      const url = `${base}/replays/${encodeURIComponent(core.sessionId)}`;
      const start = core.sessionStart;
      if (!o?.withTimestamp || start === undefined) return url;
      return `${url}?t=${Math.max(0, Math.round((Date.now() - start) / 1000 - (o.timestampLookBackSeconds ?? 10)))}`;
    },
    debug: (on = true) => void (debugOn = on),
    featureView: (key, props) => void core.capture("$feature_view", { ...props, $feature_flag: key }, { $set: { [`$feature_view/${key}`]: true } }),
    featureInteraction: (key, props) =>
      void core.capture("$feature_interaction", { ...props, $feature_flag: key }, { $set: { [`$feature_interaction/${key}`]: true } }),
    updateFlags: (f, p, o) => host.flags?.update(f, p, o?.merge ?? true),
    register: (p: Props) => core.register(p),
    registerOnce: (p: Props) => core.registerOnce(p),
    unregister: (k) => core.unregister(k),
    group: (t, k, p) => {
      person.markIdentified();
      core.group(t, k, p);
    },
    optIn: () => core.optIn(),
    optOut: () => core.optOut(),
    optOutInternal: (on = true) => {
      internal = on;
      if (on) core.storage.set(INTERNAL_KEY, "1");
      else core.storage.remove(INTERNAL_KEY);
    },
    get isInternal() {
      return internal;
    },
    setConsent: (u) => core.setConsent(u),
    getConsent: () => core.getConsent(),
    getConsentStatus: (c) => core.getConsentStatus(c),
    consentStatus: () => core.consentStatus(),
    getFlag: (k) => host.flags?.get(k),
    getFlagPayload: (k) => host.flags?.payload(k),
    getFlagResult: (k, o) => host.flags?.result(k, o) ?? flagResult(k, undefined, undefined, "not_found"),
    getLayerParam: <T>(layer: string, param: string, fallback: T) => (host.flags?.layerParam(layer, param) as T | undefined) ?? fallback,
    isFeatureEnabled: (k) => {
      const v = host.flags?.get(k);
      return v !== undefined && v !== false;
    },
    onFlags: (cb) => host.flags?.onChange(cb) ?? (() => {}),
    onIntervention: (cb) => interventions.on(cb),
    reloadFlags: () => host.flags?.reload() ?? Promise.resolve(),
    getAllFlags: () => host.flags?.all() ?? {},
    overrideFlags: (m, o) => host.flags?.override(m, o),
    setPersonPropertiesForFlags: (p, r) => host.flags?.setPersonProperties(p, r),
    resetPersonPropertiesForFlags: () => host.flags?.resetPersonProperties(),
    setGroupPropertiesForFlags: (p, r) => host.flags?.setGroupProperties(p, r),
    resetGroupPropertiesForFlags: () => host.flags?.resetGroupProperties(),
    setContext: (kind, key, properties) => host.flags?.setContext(kind, key, properties),
    clearContext: (kind) => host.flags?.clearContext(kind),
    guides: {
      showChangelog: () => host.guides?.showChangelog() ?? 0,
      show: (id) => host.guides?.show(id) ?? false,
      reset: (id) => host.guides?.reset(id),
    },
    ai: {
      startConversation: (o) => new AgentConversation((e, p) => client.capture(e, p), o, live.ai?.captureText === true).start(),
    },
    earlyAccess: {
      list: () => host.earlyAccess?.list() ?? Promise.resolve([]),
      optIn: (k) => host.earlyAccess?.optIn(k),
      optOut: (k) => host.earlyAccess?.optOut(k),
    },
    replay: {
      start: (o) => host.replay?.start(o) ?? Promise.resolve(),
      stop: () => host.replay?.stop(),
      pause: () => host.replay?.pause(),
      resume: () => host.replay?.resume(),
      tag: (n) => host.replay?.tag(n),
      isRecording: () => host.replay?.isRecording() ?? false,
    },
    consent: {
      showBanner: (o) => host.consentUi?.showBanner(o) ?? Promise.resolve(null),
      hideBanner: () => host.consentUi?.hideBanner(),
    },
    loadToolbar: (p) => host.toolbar?.load(typeof p === "string" ? p : p.token) ?? Promise.resolve(false),
    activateExperiment: (k) => host.experiments?.activate(k),
    recommendations: (placement, o) =>
      host.recs?.get(placement, o) ?? Promise.resolve({ placement, strategy: "", items: [], shown() {}, clicked() {} }),
    flush: () => core.flush(),
    shutdown: async () => {
      for (const t of teardowns) t();
      debounced?.flush();
      await core.shutdown();
    },
  };
  host.client = client;

  if (!disabled) {
    const onHide = (): void => {
      for (const fn of unload) fn();
      debounced?.flush();
      void core.flush({ beacon: true });
    };
    window.addEventListener("pagehide", onHide);
    const onVis = (): void => {
      if (document.visibilityState === "hidden") void core.flush({ beacon: true });
    };
    document.addEventListener("visibilitychange", onVis);
    teardowns.push(() => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    });
    if (offline) {
      const drain = (): void => void offline.drain();
      window.addEventListener("online", drain);
      teardowns.push(() => window.removeEventListener("online", drain));
      whenConsented(drain);
    }
    if (config.captureCspViolations) {
      const o = typeof config.captureCspViolations === "object" ? config.captureCspViolations : {};
      teardowns.push(captureCspViolations((ev, props) => void core.capture(ev, props), o));
    }
    for (const m of modules) {
      const t = m(host);
      if (t) teardowns.push(t);
    }
    flagsSvc = host.flags;
    connectDevtools(host, client, apiHost);
  }
  log("initialised", { apiHost, consent: core.getConsent() });
  return client;
}

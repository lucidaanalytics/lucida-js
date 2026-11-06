import { Core, flagEventProps, interventionHub, offlineTransport } from "@lucida-analytics/sdk-core";
import type { Transport } from "@lucida-analytics/sdk-core";
import { appLifecycle, asyncStorageAdapter, encryptedStorage, fetchTransport, memoryStorage, splitBatches, withTimeout } from "./adapters.js";
import { createAutocapture } from "./autocapture.js";
import { resolveInstallProps } from "./install.js";
import { installPolicy } from "./policy.js";
import { tracedFetch, tracingHeaders } from "./host-headers.js";
import { createFlags } from "./flags.js";
import type { FlagsService } from "./flags.js";
import { createGuides } from "./guides.js";
import { createReplay } from "./replay.js";
import type { NativeClient, NativeConfig } from "./types.js";

export const LIB = "lucida-react-native";
export const LIB_VERSION = "0.1.1";
const DEFAULT_HOST = "https://capture.lucidace.com";
const VERSION_KEY = "lc_app_version";

const noop: Transport = { send: async () => ({ status: 200 }) };

/**
 * Hydrates storage, then builds the client. Nothing is persisted before consent in opt_in mode;
 * `$app_opened` fires on creation and on every foreground, `$app_backgrounded` flushes the queue.
 */
export async function createClient(apiKey: string, config: NativeConfig = {}): Promise<NativeClient> {
  const apiHost = (config.apiHost ?? DEFAULT_HOST).replace(/\/+$/, "");
  const boot = config.flagOptions?.bootstrap;
  const fetchImpl = config.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let debugOn = !!config.debug;
  const log = (...a: unknown[]): void => {
    if (debugOn) console.debug("[lucida]", ...a);
  };
  let storage = memoryStorage();
  if (config.asyncStorage && !config.disabled) {
    const a = asyncStorageAdapter(config.asyncStorage);
    await a.ready;
    storage = a.storage;
  }
  // The offline queue and spilled replay chunks are encrypted, like the iOS and Android SDKs.
  if (config.queueCipher) storage = encryptedStorage(storage, config.queueCipher, ["lc_offline", "lc_replay"], ["lc_replay."]);

  let transport = config.transport ?? fetchTransport(fetchImpl, config.requestTimeoutMs);
  // maxBatchSize and the timeout also wrap a custom transport (G77).
  if (config.maxBatchSize) transport = splitBatches(transport, config.maxBatchSize);
  if (config.transport && config.requestTimeoutMs) transport = withTimeout(transport, config.requestTimeoutMs);
  let offline: ReturnType<typeof offlineTransport> | undefined;
  if (!config.transport && config.asyncStorage) transport = offline = offlineTransport(transport, storage);

  let flagsRef: FlagsService | undefined; // read at capture time
  const core = new Core({
    apiKey,
    apiHost,
    transport: config.disabled ? noop : transport,
    storage,
    library: { name: LIB, version: LIB_VERSION },
    ...(config.consent ? { consent: config.consent } : {}),
    ...(boot?.distinctId ? { bootstrapDistinctId: boot.distinctId } : {}),
    session: {
      ...(config.sessionIdleMs ? { idleMs: config.sessionIdleMs } : {}),
      ...(config.sessionMaxMs ? { maxMs: config.sessionMaxMs } : {}),
    },
    queue: {
      ...(config.flushAt ? { flushAt: config.flushAt } : {}),
      ...(config.flushIntervalMs ? { flushIntervalMs: config.flushIntervalMs } : {}),
      ...(config.maxQueueSize ? { maxQueueSize: config.maxQueueSize } : {}),
      ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
      ...(config.retryDelayMs ? { backoff: { baseMs: config.retryDelayMs } } : {}),
    },
    enrich: (event) => ({
      properties: {
        $os: config.platform,
        $os_version: config.osVersion,
        $app_version: config.appVersion,
        $app_build: config.appBuild,
        ...(config.sendFeatureFlags !== false && event !== "$snapshot" && flagsRef ? flagEventProps(flagsRef.all()) : {}),
      },
    }),
    log,
  });

  if (boot?.isIdentified && boot.distinctId === core.distinctId) core.identity.identify(boot.distinctId);
  const person = installPolicy(core, {
    beforeSend: config.beforeSend,
    personProfiles: config.personProfiles,
    disableGeoip: config.disableGeoip,
    log,
  });
  if (config.dataMode === "wifi" && config.network) {
    // Wi-Fi-only: skip the send and look again at the next interval; events stay queued (and persisted).
    const q = core.queue;
    const send = q.flush.bind(q);
    q.flush = (o) => {
      if (config.network!.isWifi()) return send(o);
      setTimeout(() => void q.flush(), config.flushIntervalMs ?? 5000);
      return Promise.resolve();
    };
  }

  const whenConsented = (fn: () => void): void => {
    if (config.disabled) return;
    if (core.hasConsent("analytics")) return fn();
    let done = false;
    core.onChange((c) => {
      if (!done && c === "consent" && core.hasConsent("analytics")) {
        done = true;
        fn();
      }
    });
  };

  const deps = { core, fetch: fetchImpl, apiHost, apiKey, whenConsented };
  const flags = createFlags({
    ...deps,
    localFlags: config.localFlags,
    localFlagsContext: config.localFlagsContext,
    flagStream: config.flagStream,
    appState: config.appState,
    options: config.flagOptions,
    disableRemote: config.disableRemoteFeatureFlags,
    ...(config.sendDefaultFlagProps === false
      ? {}
      : { defaultProps: { $lib: LIB, ...(config.appVersion ? { $app_version: config.appVersion } : {}), ...(config.platform ? { $os: config.platform } : {}) } }),
  });
  flagsRef = flags;
  const autocapture = createAutocapture(core, config.autocapture ?? {});
  const headersFor = tracingHeaders(config.tracingHeaders ?? [], apiHost, () => core.hasConsent("analytics"), () => ({
    distinctId: core.distinctId,
    sessionId: core.sessionId,
  }));
  const anonId = (): string => {
    try {
      return (JSON.parse(core.storage.get("lc_identity") ?? "{}") as { anon_id?: string }).anon_id ?? core.distinctId;
    } catch {
      return core.distinctId;
    }
  };
  const personBlocked = (what: string): boolean => {
    if (person.blocksPersonWrites) log(`personProfiles=never: ${what} ignored`);
    return person.blocksPersonWrites;
  };

  const guides = createGuides({ core, fetch: fetchImpl, apiHost, apiKey, flag: (k) => ![undefined, false].includes(flags.get(k) as boolean | undefined) });
  if (config.guides?.enabled && !config.disabled) {
    // after flags: `flag_key` targeting reads them
    const load = (): void => void flags.reload().finally(() => void guides.reload());
    whenConsented(load);
    core.onChange((c) => {
      if (c === "identify" || c === "reset" || c === "group") load();
    });
  }

  const replay = config.replay?.enabled && !config.disabled ? createReplay({ core, storage, log, fetch: fetchImpl, apiHost, apiKey, config: config.replay, isFlagOn: (k) => { const v = flags.all()[k]; return v !== undefined && v !== false; } }) : undefined;

  // React Native fetch has no streaming body: the hub falls back to polling GET /v1/interventions.
  const interventions = interventionHub(core, { apiHost, apiKey, fetch: fetchImpl, whenConsented, log, disabled: !!config.disabled });
  const client: NativeClient = {
    get distinctId() {
      return core.distinctId;
    },
    getAnonymousId: anonId,
    isOptedOut: () => !core.hasConsent("analytics"),
    debug(on) {
      debugOn = on;
    },
    capture: (e, p, o) =>
      void core.capture(e, p, { ...(o?.set ? { $set: o.set } : {}), ...(o?.setOnce ? { $set_once: o.setOnce } : {}) }),
    setPersonProperties(set, setOnce) {
      if (personBlocked("setPersonProperties")) return;
      core.capture("$set", {}, { ...(set ? { $set: set } : {}), ...(setOnce ? { $set_once: setOnce } : {}) });
    },
    openURL(url, referrer) {
      const query: Record<string, string> = {};
      for (const kv of (url.split("#")[0]!.split("?")[1] ?? "").split("&")) {
        if (!kv) continue;
        const [k = "", v = ""] = kv.split("=");
        query[decodeURIComponent(k)] = decodeURIComponent(v);
      }
      core.capture("$deep_link_opened", { url, query, ...(referrer ? { referrer } : {}) });
    },
    fetch: tracedFetch(fetchImpl, headersFor),
    autocapture,
    screen(name, props) {
      core.capture("$screen", { ...props, $screen_name: name });
      replay?.setScreen(name);
      if (config.guides?.enabled) guides.show(name);
    },
    identify(id, s, o) {
      if (!personBlocked("identify")) core.identify(id, s, o);
    },
    alias(a, o) {
      if (!personBlocked("alias")) core.alias(a, o);
    },
    reset() {
      person.reset();
      replay?.clearSpool();
      core.reset({ reuseAnonymousId: !!config.reuseAnonymousId });
    },
    register: (p) => core.register(p),
    registerOnce: (p) => core.registerOnce(p),
    unregister: (k) => core.unregister(k),
    group: (t, k, p) => core.group(t, k, p),
    optIn: () => core.optIn(),
    optOut: () => {
      replay?.clearSpool();
      core.optOut();
    },
    getFlag: (k) => flags.get(k),
    getFlagPayload: (k) => flags.payload(k),
    getFlagResult: (k, o) => flags.result(k, o),
    isFeatureEnabled: (k) => {
      const v = flags.get(k);
      return v !== undefined && v !== false;
    },
    onFlags: (cb) => flags.onChange(cb),
    onIntervention: (cb) => interventions.on(cb),
    reloadFlags: () => flags.reload(),
    updateFlags: (f, p, o) => flags.update(f, p, o),
    getAllFlags: () => flags.all(),
    overrideFlags: (m) => flags.override(m),
    setPersonPropertiesForFlags: (p, r) => flags.setPersonProperties(p, r),
    resetPersonPropertiesForFlags: (r) => flags.resetPersonProperties(r),
    setGroupPropertiesForFlags: (t, p, r) => flags.setGroupProperties(t, p, r),
    resetGroupPropertiesForFlags: (r) => flags.resetGroupProperties(r),
    replay: {
      start: () => replay?.start(),
      stop: () => replay?.stop(),
      pause: () => replay?.pause(),
      resume: () => replay?.resume(),
      tag: (name) => void core.capture("$replay_tag", { name, session_id: core.sessionId }),
      isRecording: () => replay?.isRecording() ?? false,
      tap: (x, y) => replay?.tap(x, y),
      swipeBegan: () => replay?.swipeBegan(),
      swipeEnded: (dx, dy) => void replay?.swipeEnded(dx, dy),
    },
    captureSensitive: (field, value) => replay?.captureSensitive(field, value) ?? false,
    guides,
    flush: () => core.flush(),
    shutdown: async () => {
      stopLifecycle();
      flags.stop();
      interventions.stop();
      replay?.stop();
      await core.shutdown();
    },
  };

  const opened = (): void => void core.capture("$app_opened");
  const prev = core.storage.get(VERSION_KEY);
  if (config.appVersion && prev !== config.appVersion) {
    const base = { $app_version: config.appVersion };
    if (prev !== null) core.capture("$app_updated", { ...base, $previous_app_version: prev });
    else if (config.installInfo && config.installAttribution !== false) {
      // The version key is stored below, so the install fires once even though attribution resolves later.
      void resolveInstallProps(config.installInfo, { fetch: fetchImpl }).then((extra) => core.capture("$app_installed", { ...base, ...extra }));
    } else core.capture("$app_installed", base);
    core.storage.set(VERSION_KEY, config.appVersion);
  }
  opened();

  const stopLifecycle = config.appState
    ? appLifecycle(config.appState, {
        onForeground() {
          opened();
          void offline?.drain();
        },
        onBackground() {
          core.capture("$app_backgrounded");
          void core.flush();
        },
      })
    : () => undefined;

  replay?.start();
  if (offline) whenConsented(() => void offline.drain());
  log("initialised", { apiHost });
  return client;
}

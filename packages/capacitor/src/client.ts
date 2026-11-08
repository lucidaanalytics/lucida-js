import { Core, flagEventProps, offlineTransport } from "@lucida-analytics/sdk-core";
import type { ConsentMode, ConsentState, FlagValue, Props, Storage, Transport } from "@lucida-analytics/sdk-core";
import { appLifecycle, capacitorBridge, fetchTransport, memoryStorage, preferencesStorage, stripReserved } from "./adapters.js";
import type { AppPluginLike, PreferencesLike } from "./adapters.js";
import { createFlags } from "./flags.js";

export const LIB = "lucida-capacitor";
export const LIB_VERSION = "0.1.2";
const DEFAULT_HOST = "https://capture.lucidace.com";

export interface CapacitorConfig {
  apiHost?: string;
  /** Default opt_out, like every Lucida SDK. In opt_in nothing is captured or written to Preferences before `optIn()`. */
  consent?: { mode?: ConsentMode; queueBeforeConsent?: boolean };
  /** `Preferences` from `@capacitor/preferences`; default `Capacitor.Plugins.Preferences`, else memory only. */
  preferences?: PreferencesLike;
  /** `App` from `@capacitor/app`; default `Capacitor.Plugins.App`. Without it no lifecycle events are captured. */
  app?: AppPluginLike;
  /** `$os`; default `Capacitor.getPlatform()` (`ios`, `android`, `web`). */
  platform?: string;
  osVersion?: string;
  appVersion?: string;
  fetch?: typeof fetch;
  /** Custom transport (tests, proxies); disables the persisted offline queue. */
  transport?: Transport;
  flushAt?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  maxRetries?: number;
  /** Fetch flags at startup. Default true. */
  preloadFlags?: boolean;
  /** Attach `$feature/<key>` flag values to every event. Default true. */
  sendFeatureFlags?: boolean;
  debug?: boolean;
}

export interface CapacitorClient {
  readonly distinctId: string;
  isOptedOut(): boolean;
  capture(event: string, props?: Props): void;
  /** `$screen` with `$screen_name`. */
  screen(name: string, props?: Props): void;
  identify(id: string, set?: Props, setOnce?: Props): void;
  alias(alias: string): void;
  group(type: string, key: string, props?: Props): void;
  register(props: Props): void;
  reset(): void;
  optIn(): void;
  optOut(): void;
  setConsent(update: Partial<ConsentState>): void;
  getFlag(key: string): FlagValue | undefined;
  isFeatureEnabled(key: string): boolean;
  getFlagPayload(key: string): unknown;
  reloadFlags(): Promise<void>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Hydrates Preferences, then builds the client on @lucida-analytics/sdk-core. `$app_opened` fires on creation and on every
 * return to the foreground, `$app_backgrounded` flushes the queue.
 */
export async function createClient(apiKey: string, config: CapacitorConfig = {}): Promise<CapacitorClient> {
  const apiHost = (config.apiHost ?? DEFAULT_HOST).replace(/\/+$/, "");
  const bridge = capacitorBridge();
  const fetchImpl = config.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const log = (...a: unknown[]): void => {
    if (config.debug) console.debug("[lucida]", ...a);
  };
  const prefs: PreferencesLike | undefined = config.preferences ?? bridge?.Plugins?.Preferences;
  let storage: Storage = memoryStorage();
  if (prefs) {
    const p = preferencesStorage(prefs);
    await p.ready;
    storage = p.storage;
  }
  let transport = config.transport ?? fetchTransport(fetchImpl);
  // Events reach the transport only after consent, so parking failed batches in Preferences respects the gate.
  const offline = !config.transport && prefs ? offlineTransport(transport, storage) : undefined;
  if (offline) transport = offline;

  const platform = config.platform ?? bridge?.getPlatform?.();
  let flagValues = (): Record<string, FlagValue> => ({});
  const core = new Core({
    apiKey,
    apiHost,
    transport,
    storage,
    library: { name: LIB, version: LIB_VERSION },
    ...(config.consent ? { consent: config.consent } : {}),
    queue: {
      ...(config.flushAt ? { flushAt: config.flushAt } : {}),
      ...(config.flushIntervalMs ? { flushIntervalMs: config.flushIntervalMs } : {}),
      ...(config.maxQueueSize ? { maxQueueSize: config.maxQueueSize } : {}),
      ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    },
    enrich: () => ({
      properties: {
        ...(platform ? { $os: platform } : {}),
        ...(config.osVersion ? { $os_version: config.osVersion } : {}),
        ...(config.appVersion ? { $app_version: config.appVersion } : {}),
        ...(config.sendFeatureFlags !== false ? flagEventProps(flagValues()) : {}),
      },
    }),
    log,
  });

  const flags = createFlags({ core, fetch: fetchImpl, apiHost, apiKey, appVersion: config.appVersion });
  flagValues = flags.all;
  const reloadOnConsent = (): void => {
    if (config.preloadFlags !== false) void flags.reload();
  };
  core.onChange((c) => {
    if (c === "identify" || c === "reset" || c === "group" || (c === "consent" && core.hasConsent("analytics"))) reloadOnConsent();
    if (c === "consent" && core.hasConsent("analytics")) void offline?.drain();
  });
  reloadOnConsent();

  const app = config.app ?? bridge?.Plugins?.App;
  const stopLifecycle = app
    ? appLifecycle(app, {
        onForeground() {
          core.capture("$app_opened", { from_background: true });
          void offline?.drain();
        },
        onBackground() {
          core.capture("$app_backgrounded");
          void core.flush();
        },
      })
    : () => undefined;
  core.capture("$app_opened", { from_background: false });
  if (offline && core.hasConsent("analytics")) void offline.drain();

  const isOn = (v: FlagValue | undefined): boolean => v !== undefined && v !== false;
  return {
    get distinctId() {
      return core.distinctId;
    },
    isOptedOut: () => !core.hasConsent("analytics"),
    capture: (e, p) => void core.capture(e, stripReserved(p)),
    screen: (name, p) => void core.capture("$screen", { ...stripReserved(p), $screen_name: name }),
    identify: (id, set, setOnce) => core.identify(id, set && stripReserved(set), setOnce && stripReserved(setOnce)),
    alias: (a) => core.alias(a),
    group: (t, k, p) => core.group(t, k, p && stripReserved(p)),
    register: (p) => core.register(stripReserved(p)),
    reset: () => core.reset(),
    optIn: () => core.optIn(),
    optOut: () => core.optOut(),
    setConsent: (u) => core.setConsent(u),
    getFlag: (k) => flags.get(k),
    isFeatureEnabled: (k) => isOn(flags.get(k)),
    getFlagPayload: (k) => flags.payload(k),
    reloadFlags: () => flags.reload(),
    flush: () => core.flush(),
    async shutdown() {
      stopLifecycle();
      await core.shutdown();
    },
  };
}

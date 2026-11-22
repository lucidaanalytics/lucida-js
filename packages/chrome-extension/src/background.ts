import { Core, flagEventProps, offlineTransport } from "@lucida-analytics/sdk-core";
import type { ConsentMode, ConsentState, FlagValue, Props, Storage, Transport } from "@lucida-analytics/sdk-core";
import { browserInfo, extensionStorage, fetchTransport, memoryStorage, osName, stripReserved } from "./adapters.js";
import { webExtension } from "./chrome.js";
import type { ChromeLike, InstalledDetails } from "./chrome.js";
import { createFlags } from "./flags.js";
import { isMessage } from "./protocol.js";
import type { Message, Reply } from "./protocol.js";

export const LIB = "lucida-chrome-extension";
export const LIB_VERSION = "0.1.0";
const DEFAULT_HOST = "https://capture.lucidace.com";

export interface ExtensionConfig {
  apiHost?: string;
  /** Default opt_out, like every Lucida SDK. Use opt_in when your Web Store listing promises consent first. */
  consent?: { mode?: ConsentMode; queueBeforeConsent?: boolean };
  /**
   * Uninstall tracking (chrome.runtime.setUninstallURL). Default true: removing the extension opens a Lucida page that
   * records `$extension_uninstalled` and says the extension was removed. A string is your own page (a survey, say): it
   * opens with `lucida_distinct_id` and `lucida_extension_version` appended, and nothing is recorded by Lucida. false: off.
   */
  uninstall?: boolean | string;
  /**
   * What content-script events say about the tab they ran in. Default "none" (nothing about the page the user is on).
   * "host" adds `$host`; "url" adds `$current_url` too. Declare it in your privacy policy before turning it on.
   */
  tabUrl?: "none" | "host" | "url";
  /** Inject the WebExtensions API (tests); default `browser` (Firefox) or `chrome`. */
  chrome?: ChromeLike;
  fetch?: typeof fetch;
  /** Custom transport (tests, proxies); disables the persisted offline queue. */
  transport?: Transport;
  /** The worker is stopped after ~30 s idle, so batches go out quickly. Defaults 20 events / 3000 ms. */
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

export interface ExtensionClient {
  readonly distinctId: string;
  isOptedOut(): boolean;
  capture(event: string, props?: Props): void;
  /** `$screen` with `$screen_name` (an extension page: popup, options, side panel). */
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
  /** Every flag value (no `$feature_flag_called`). */
  getFlags(): Record<string, FlagValue>;
  reloadFlags(): Promise<void>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * The client for the extension's background service worker (or Firefox event page). Call it at the top level of the
 * worker script: install/update/startup and message listeners are registered synchronously, before the first await,
 * because Chrome only delivers those events to listeners added in the worker's first turn.
 */
export function createClient(apiKey: string, config: ExtensionConfig = {}): Promise<ExtensionClient> {
  const ext = config.chrome ?? webExtension();
  if (!ext) throw new Error("@lucida-analytics/chrome-extension: no chrome/browser extension API here; use it in the background worker, and connect() from pages and content scripts");
  const pending: Array<(c: ExtensionClient) => void> = [];
  let client: ExtensionClient | undefined;
  const later = (f: (c: ExtensionClient) => void): void => (client ? f(client) : void pending.push(f));

  ext.runtime.onInstalled?.addListener((d: InstalledDetails) =>
    later((c) => {
      if (d.reason === "install") c.capture("$extension_installed");
      else if (d.reason === "update" && d.previousVersion !== ext.runtime.getManifest().version) c.capture("$extension_updated", { $previous_version: d.previousVersion });
    }),
  );
  ext.runtime.onStartup?.addListener(() => later((c) => c.capture("$extension_started")));
  ext.runtime.onSuspend?.addListener(() => later((c) => void c.flush()));
  ext.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!isMessage(msg)) return undefined; // not ours: leave it to the extension's own listeners
    later((c) => {
      void handle(c, msg, sender, config.tabUrl ?? "none").then(reply, (e: unknown) => reply({ ok: false, error: String(e) } satisfies Reply));
    });
    return true; // reply is async
  });

  return build(apiKey, config, ext).then((c) => {
    client = c;
    for (const f of pending.splice(0)) f(c);
    return c;
  });
}

async function handle(c: ExtensionClient, m: Message, sender: { tab?: { url?: string } }, tabUrl: string): Promise<Reply> {
  const ctx: Props = m.context ? { $extension_context: m.context } : {};
  if (sender.tab?.url && tabUrl !== "none") {
    try {
      const u = new URL(sender.tab.url);
      ctx.$host = u.host;
      if (tabUrl === "url") ctx.$current_url = sender.tab.url;
    } catch {
      /* not a URL: say nothing */
    }
  }
  switch (m.op) {
    case "capture": c.capture(m.event, { ...m.props, ...ctx }); break;
    case "screen": c.screen(m.name, { ...m.props, ...ctx }); break;
    case "identify": c.identify(m.id, m.set, m.setOnce); break;
    case "alias": c.alias(m.alias); break;
    case "group": c.group(m.type, m.key, m.props); break;
    case "register": c.register(m.props); break;
    case "reset": c.reset(); break;
    case "optIn": c.optIn(); break;
    case "optOut": c.optOut(); break;
    case "setConsent": c.setConsent(m.update); break;
    case "flag": return { ok: true, value: c.getFlag(m.key) };
    case "payload": return { ok: true, value: c.getFlagPayload(m.key) };
    case "flags": return { ok: true, value: c.getFlags() };
    case "distinctId": return { ok: true, value: c.distinctId };
    case "flush": await c.flush(); break;
    default: return { ok: false, error: "unknown op" };
  }
  return { ok: true };
}

async function build(apiKey: string, config: ExtensionConfig, ext: ChromeLike): Promise<ExtensionClient> {
  const apiHost = (config.apiHost ?? DEFAULT_HOST).replace(/\/+$/, "");
  const fetchImpl = config.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const log = (...a: unknown[]): void => {
    if (config.debug) console.debug("[lucida]", ...a);
  };
  const area = ext.storage?.local;
  if (!area) console.warn('[lucida] add "storage" to "permissions" in manifest.json: without it the identity and offline queue are lost each time the worker stops');
  const s = area ? extensionStorage(area) : { storage: memoryStorage(), ready: Promise.resolve() };
  const [, platform] = await Promise.all([s.ready, ext.runtime.getPlatformInfo?.().catch(() => undefined)]);
  const storage: Storage = s.storage;
  let transport = config.transport ?? fetchTransport(fetchImpl);
  const offline = config.transport ? undefined : offlineTransport(transport, storage);
  if (offline) transport = offline;

  const version = ext.runtime.getManifest().version;
  const fixed: Props = {
    $extension_id: ext.runtime.id,
    $extension_version: version,
    $app_version: version,
    ...(osName(platform?.os) ? { $os: osName(platform?.os) } : {}),
    ...browserInfo((globalThis as { navigator?: Parameters<typeof browserInfo>[0] }).navigator),
  };
  let flagValues = (): Record<string, FlagValue> => ({});
  const core = new Core({
    apiKey,
    apiHost,
    transport,
    storage,
    library: { name: LIB, version: LIB_VERSION },
    ...(config.consent ? { consent: config.consent } : {}),
    queue: {
      flushAt: config.flushAt ?? 20,
      flushIntervalMs: config.flushIntervalMs ?? 3000,
      ...(config.maxQueueSize ? { maxQueueSize: config.maxQueueSize } : {}),
      ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    },
    enrich: () => ({ properties: { ...fixed, ...(config.sendFeatureFlags !== false ? flagEventProps(flagValues()) : {}) } }),
    log,
  });

  const flags = createFlags({ core, fetch: fetchImpl, apiHost, apiKey, appVersion: version });
  flagValues = flags.all;
  const uninstall = (): void => {
    const set = ext.runtime.setUninstallURL;
    if (!set || config.uninstall === false) return;
    let url = "";
    if (typeof config.uninstall === "string") {
      const u = new URL(config.uninstall);
      if (core.hasConsent("analytics")) u.searchParams.set("lucida_distinct_id", core.distinctId);
      u.searchParams.set("lucida_extension_version", version);
      url = u.toString();
    } else if (core.hasConsent("analytics")) {
      const q = new URLSearchParams({ k: apiKey, e: "$extension_uninstalled", d: core.distinctId, fmt: "html", "p.$extension_version": version, "p.$extension_id": ext.runtime.id, "p.$lib": LIB });
      url = `${apiHost}/v1/p.gif?${q.toString()}`;
    }
    void Promise.resolve(set.call(ext.runtime, url)).catch(() => undefined); // "" clears it (no consent)
  };
  core.onChange((c) => {
    if (c === "identify" || c === "reset" || c === "consent") uninstall();
    if (config.preloadFlags !== false && (c === "identify" || c === "reset" || c === "group" || (c === "consent" && core.hasConsent("analytics")))) void flags.reload();
    if (c === "consent" && core.hasConsent("analytics")) void offline?.drain();
  });
  uninstall();
  if (config.preloadFlags !== false) void flags.reload();
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
    getFlags: () => flags.all(),
    reloadFlags: () => flags.reload(),
    flush: () => core.flush(),
    shutdown: () => core.shutdown(),
  };
}

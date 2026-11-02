import type { Props, Storage, Transport } from "@lucida-analytics/sdk-core";

/** The slice of `@capacitor/preferences` the SDK uses (inject `Preferences`, or it is read from the Capacitor bridge). */
export interface PreferencesLike {
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
}

/** Listener handle of a Capacitor plugin (`remove()` returns a promise on Capacitor 5+). */
export interface ListenerHandleLike {
  remove(): Promise<void> | void;
}

/** The slice of `@capacitor/app` the SDK uses. */
export interface AppPluginLike {
  addListener(
    event: "appStateChange",
    fn: (state: { isActive: boolean }) => void,
  ): Promise<ListenerHandleLike> | ListenerHandleLike;
}

/** The slice of the `window.Capacitor` bridge object the SDK reads. */
export interface CapacitorBridgeLike {
  getPlatform?(): string;
  Plugins?: { Preferences?: PreferencesLike; App?: AppPluginLike };
}

/** `globalThis.Capacitor` when running inside a Capacitor app, else undefined. */
export function capacitorBridge(): CapacitorBridgeLike | undefined {
  return (globalThis as { Capacitor?: CapacitorBridgeLike }).Capacitor;
}

/** Keys the SDK persists; hydrated up front because the core's Storage port is synchronous. */
export const PERSISTED_KEYS = [
  "lc_identity", "lc_session", "lc_props", "lc_groups", "lc_consent", "lc_flags", "lc_offline", "lc_device_id",
] as const;

const PREFIX = "lucida.";

/**
 * Memory cache hydrated from Preferences with write-behind. Await `ready` before use. Reads happen at startup;
 * writes only come through the core's consent gate, so nothing is written before consent in opt_in mode.
 */
export function preferencesStorage(prefs: PreferencesLike): { storage: Storage; ready: Promise<void> } {
  const mem = new Map<string, string>();
  const ready = Promise.all(
    PERSISTED_KEYS.map((k) =>
      prefs.get({ key: PREFIX + k }).then(
        (r) => void (r.value !== null && r.value !== undefined && mem.set(k, r.value)),
        () => undefined, // unreadable key: start without it rather than fail init
      ),
    ),
  ).then(() => undefined);
  const swallow = (p: Promise<void>): void => void p.catch(() => undefined);
  return {
    ready,
    storage: {
      get: (k) => mem.get(k) ?? null,
      set(k, v) {
        mem.set(k, v);
        swallow(prefs.set({ key: PREFIX + k, value: v }));
      },
      remove(k) {
        mem.delete(k);
        swallow(prefs.remove({ key: PREFIX + k }));
      },
    },
  };
}

/** In-memory storage (tests, or no Preferences plugin available). */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

/** fetch-based transport; status 0 on network failure (retried by the queue, parked by the offline store). */
export function fetchTransport(fetchImpl: typeof fetch): Transport {
  return {
    async send(url, body) {
      try {
        const r = await fetchImpl(url, { method: "POST", body, headers: { "Content-Type": "text/plain;charset=UTF-8" } });
        return { status: r.status };
      } catch {
        return { status: 0 };
      }
    },
  };
}

/** Maps Capacitor `appStateChange` to foreground/background callbacks; returns an unsubscribe. */
export function appLifecycle(app: AppPluginLike, h: { onForeground(): void; onBackground(): void }): () => void {
  let active = true; // the client is created while the app is in the foreground
  let handle: ListenerHandleLike | undefined;
  let stopped = false;
  void Promise.resolve(
    app.addListener("appStateChange", ({ isActive }) => {
      if (isActive && !active) h.onForeground();
      else if (!isActive && active) h.onBackground();
      active = isActive;
    }),
  ).then((x) => {
    handle = x;
    if (stopped) void x.remove();
  }, () => undefined);
  return () => {
    stopped = true;
    if (handle) void handle.remove();
  };
}

/** Drops caller-supplied `$lc_*` keys: they are reserved for the gateway and never sent by the client. */
export function stripReserved(props: Props | undefined): Props {
  const out: Props = {};
  if (props) for (const [k, v] of Object.entries(props)) if (!k.startsWith("$lc_")) out[k] = v;
  return out;
}

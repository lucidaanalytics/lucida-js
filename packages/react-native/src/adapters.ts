import type { Storage, Transport } from "@lucida/sdk-core";

/** The slice of @react-native-async-storage/async-storage the SDK uses (inject the real module). */
export interface AsyncStorageLike {
  multiGet(keys: readonly string[]): Promise<ReadonlyArray<readonly [string, string | null]>>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Keys the SDK persists; hydrated up front because the core's Storage port is synchronous. */
export const PERSISTED_KEYS = [
  "lc_identity", "lc_session", "lc_props", "lc_groups", "lc_consent", "lc_flags", "lc_offline",
  "lc_app_version", "lc_guide_seen", "lc_person_identified",
] as const;

/** Memory cache hydrated from AsyncStorage with write-behind. Await `ready` before use. */
export function asyncStorageAdapter(as: AsyncStorageLike): { storage: Storage; ready: Promise<void> } {
  const mem = new Map<string, string>();
  const ready = as.multiGet(PERSISTED_KEYS).then(
    (rows) => {
      for (const [k, v] of rows) if (v !== null) mem.set(k, v);
    },
    () => undefined, // unreadable storage: start empty rather than fail init
  );
  const swallow = (p: Promise<void>): void => void p.catch(() => undefined);
  return {
    ready,
    storage: {
      get: (k) => mem.get(k) ?? null,
      set(k, v) {
        mem.set(k, v);
        swallow(as.setItem(k, v));
      },
      remove(k) {
        mem.delete(k);
        swallow(as.removeItem(k));
      },
    },
  };
}

/** In-memory storage (tests, no AsyncStorage injected). */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

/** fetch-based transport. No gzip: React Native has no CompressionStream; batches are small. */
export function fetchTransport(fetchImpl: typeof fetch, timeoutMs = 0): Transport {
  return {
    async send(url, body) {
      const ctl = timeoutMs > 0 && typeof AbortController !== "undefined" ? new AbortController() : undefined;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : undefined;
      try {
        const r = await fetchImpl(url, {
          method: "POST",
          body,
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          ...(ctl ? { signal: ctl.signal } : {}),
        });
        return { status: r.status };
      } catch {
        return { status: 0 };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Sends batches of at most `max` events: a larger `{api_key, batch, sent_at}` body is split; the first failing status wins. */
export function splitBatches(inner: Transport, max: number): Transport {
  return {
    async send(url, body, opts) {
      let parsed: { batch?: unknown[] } | undefined;
      try {
        parsed = JSON.parse(body) as { batch?: unknown[] };
      } catch {
        return inner.send(url, body, opts);
      }
      const batch = parsed.batch;
      if (!Array.isArray(batch) || batch.length <= max) return inner.send(url, body, opts);
      for (let i = 0; i < batch.length; i += max) {
        const r = await inner.send(url, JSON.stringify({ ...parsed, batch: batch.slice(i, i + max) }), opts);
        if (r.status < 200 || r.status >= 300) return r;
      }
      return { status: 200 };
    },
  };
}

export type AppStateStatus = "active" | "background" | "inactive" | "unknown" | "extension";

/** The slice of react-native's AppState the SDK uses. */
export interface AppStateLike {
  currentState?: AppStateStatus;
  addEventListener(type: "change", fn: (s: AppStateStatus) => void): { remove(): void };
}

/** Maps foreground/background transitions to callbacks; returns an unsubscribe. */
export function appLifecycle(app: AppStateLike, h: { onForeground(): void; onBackground(): void }): () => void {
  let fg = app.currentState === "active";
  const sub = app.addEventListener("change", (s) => {
    if (s === "active" && !fg) h.onForeground();
    else if (s !== "active" && fg) h.onBackground();
    fg = s === "active";
  });
  return () => sub.remove();
}

/** Aborts nothing (a custom transport owns its sockets) but stops waiting after `ms`: the send then counts as a network failure and retries. */
export function withTimeout(inner: Transport, ms: number): Transport {
  if (ms <= 0) return inner;
  return {
    send: (url, body, opts) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ status: 0 }), ms);
        inner.send(url, body, opts).then(
          (r) => (clearTimeout(timer), resolve(r)),
          () => (clearTimeout(timer), resolve({ status: 0 })),
        );
      }),
  };
}

/** Port: at-rest encryption for the persisted queue. `nativeQueueCipher()` backs it with the iOS Keychain / Android Keystore. */
export interface QueueCipher {
  encrypt(plain: string): string;
  /** null when the value cannot be decrypted (key rotated, corrupt): the queue then starts empty. */
  decrypt(cipher: string): string | null;
}

/** Decorator: values under `keys` are stored encrypted, everything else passes through. */
export function encryptedStorage(inner: Storage, cipher: QueueCipher, keys: readonly string[]): Storage {
  const enc = new Set(keys);
  return {
    get: (k) => {
      const v = inner.get(k);
      return v !== null && enc.has(k) ? cipher.decrypt(v) : v;
    },
    set: (k, v) => inner.set(k, enc.has(k) ? cipher.encrypt(v) : v),
    remove: (k) => inner.remove(k),
  };
}

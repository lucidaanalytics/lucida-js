import type { AppPluginLike, CapacitorConfig, PreferencesLike } from "../src/index.js";

export interface Sent {
  uuid: string;
  event: string;
  distinct_id?: string;
  properties: Record<string, unknown>;
}

/** Preferences fake that records every write. */
export function fakePreferences(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const writes: string[] = [];
  const prefs: PreferencesLike = {
    get: async ({ key }) => ({ value: data.get(key) ?? null }),
    set: async ({ key, value }) => void (writes.push(key), data.set(key, value)),
    remove: async ({ key }) => void (writes.push(key), data.delete(key)),
  };
  return { prefs, data, writes };
}

/** App plugin fake: `emit(isActive)` drives appStateChange. */
export function fakeApp(): AppPluginLike & { emit(isActive: boolean): void; listeners: number } {
  const fns: Array<(s: { isActive: boolean }) => void> = [];
  return {
    get listeners() {
      return fns.length;
    },
    addListener: async (_e, fn) => {
      fns.push(fn);
      return { remove: async () => void fns.splice(fns.indexOf(fn), 1) };
    },
    emit: (isActive) => fns.forEach((f) => f({ isActive })),
  };
}

/** Config with a recording transport and a flags fetch that answers `flagsBody`. */
export function setup(over: CapacitorConfig = {}, flagsBody: unknown = { flags: {} }) {
  const sent: Sent[] = [];
  const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchUrls: string[] = [];
  const cfg: CapacitorConfig = {
    apiHost: "https://ingest.test/",
    flushAt: 1,
    platform: "ios",
    transport: {
      send: async (url, body) => {
        const b = JSON.parse(body) as { batch: Sent[] };
        bodies.push({ url, body: b as unknown as Record<string, unknown> });
        sent.push(...b.batch);
        return { status: 200 };
      },
    },
    fetch: (async (url: string) => {
      fetchUrls.push(url);
      return { ok: true, status: 200, json: async () => flagsBody };
    }) as unknown as typeof fetch,
    ...over,
  };
  return { cfg, sent, bodies, fetchUrls };
}

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

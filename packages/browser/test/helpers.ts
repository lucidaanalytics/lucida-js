import { createClient, init } from "../src/index.js";
import type { BrowserConfig, Client, Module } from "../src/index.js";

export interface Sent {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

export function fakeTransport() {
  const calls: Array<{ url: string; body: string; beacon: boolean }> = [];
  return {
    calls,
    send: async (url: string, body: string, opts?: { beacon?: boolean }) => {
      calls.push({ url, body, beacon: !!opts?.beacon });
      return { status: 200 };
    },
    events: (): Sent[] => calls.flatMap((c) => (JSON.parse(c.body) as { batch: Sent[] }).batch),
  };
}

export function fakeFetch(handlers: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const key = Object.keys(handlers).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? handlers[key] : {}), { status: key ? 200 : 404 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

export function start(config: BrowserConfig = {}, key = "lc_pk_test") {
  const t = fakeTransport();
  const f = fakeFetch((config as { _h?: Record<string, unknown> })._h ?? {});
  const client: Client = init(key, {
    persistence: "memory",
    apiHost: "https://ingest.test",
    transport: t,
    fetch: f.fn,
    ...config,
  });
  return { client, t, f };
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Like start(), but with an explicit module list (createClient). */
export function startWith(modules: Module[], config: BrowserConfig = {}, key = "lc_pk_test") {
  const t = fakeTransport();
  const f = fakeFetch((config as { _h?: Record<string, unknown> })._h ?? {});
  const client = createClient(
    key,
    { persistence: "memory", apiHost: "https://ingest.test", transport: t, fetch: f.fn, capturePageview: false, ...config },
    modules,
  );
  return { client, t, f };
}

import { describe, expect, it, vi } from "vitest";
import { createClient } from "../src/index.js";
import type { NativeConfig } from "../src/index.js";

function setup(over: NativeConfig = {}, flagsBody: unknown = { flags: { a: { enabled: true, value: true, reason: "condition_match" }, v: { enabled: true, value: "B", variant: "B", payload: { n: 1 } } } }) {
  const reqs: Array<{ url: string }> = [];
  const cfg: NativeConfig = {
    apiHost: "https://ingest.test",
    flushAt: 1000,
    appVersion: "2.1.0",
    platform: "ios",
    transport: { send: async () => ({ status: 200 }) },
    fetch: (async (url: string) => {
      reqs.push({ url });
      return { ok: true, status: 200, json: async () => flagsBody };
    }) as unknown as typeof fetch,
    ...over,
  };
  return { cfg, flagReqs: () => reqs.filter((r) => r.url.endsWith("/v1/flags")).length };
}

describe("react-native getFlagResult", () => {
  it("returns value, variant, payload and reason; override and not_found are labelled", async () => {
    const { cfg } = setup();
    const c = await createClient("lc_pk_x", cfg);
    await vi.waitFor(() => expect(c.getFlag("v")).toBe("B"));
    expect(c.getFlagResult("a", { sendExposure: false })).toEqual({ key: "a", value: true, enabled: true, reason: "condition_match" });
    expect(c.getFlagResult("v", { sendExposure: false })).toEqual({ key: "v", value: "B", enabled: true, variant: "B", payload: { n: 1 }, reason: "remote" });
    expect(c.getFlagResult("zz", { sendExposure: false }).reason).toBe("not_found");
    c.overrideFlags({ a: false });
    expect(c.getFlagResult("a")).toMatchObject({ value: false, enabled: false, reason: "override" });
    c.updateFlags({ q: true });
    expect(c.getFlagResult("q", { sendExposure: false }).reason).toBe("pushed");
    await c.shutdown();
  });
});

describe("react-native flag request cache TTL", () => {
  it("a cached response younger than the TTL skips the launch request; reloadFlags still fetches", async () => {
    const store = new Map<string, string>();
    const storage = { multiGet: async (ks: readonly string[]) => ks.map((k) => [k, store.get(k) ?? null] as const), setItem: async (k: string, v: string) => void store.set(k, v), removeItem: async (k: string) => void store.delete(k) };
    const first = setup({ asyncStorage: storage, flagOptions: { cacheTtlMs: 60_000 } } as NativeConfig);
    const c1 = await createClient("lc_pk_x", first.cfg);
    await vi.waitFor(() => expect(first.flagReqs()).toBe(1));
    await vi.waitFor(() => expect(store.get("lc_flags") ?? "").toContain('"at"'));
    await c1.shutdown();

    const second = setup({ asyncStorage: storage, flagOptions: { cacheTtlMs: 60_000 } } as NativeConfig);
    const c2 = await createClient("lc_pk_x", second.cfg);
    expect(c2.getFlag("v")).toBe("B"); // served from the cache
    await new Promise((r) => setTimeout(r, 30));
    expect(second.flagReqs()).toBe(0);
    await c2.reloadFlags();
    expect(second.flagReqs()).toBe(1);
    await c2.shutdown();

    const third = setup({ asyncStorage: storage } as NativeConfig); // no TTL: launch always fetches
    const c3 = await createClient("lc_pk_x", third.cfg);
    await vi.waitFor(() => expect(third.flagReqs()).toBe(1));
    await c3.shutdown();
  });
});

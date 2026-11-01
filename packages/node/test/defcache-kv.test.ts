import { describe, expect, it } from "vitest";
import { KvFlagDefinitionCache, Lucida, redisFlagDefinitionCache, type KvClient } from "../src/index.js";
import { fakeGateway, flag } from "./helpers.js";

/** In-memory stand-in for a key-value store; TTLs are recorded, not enforced. */
function memoryKv() {
  const m = new Map<string, string>();
  const ttls = new Map<string, number>();
  const kv: KvClient = {
    get: (k) => m.get(k) ?? null,
    set: (k, v, ttl, ifAbsent) => {
      if (ifAbsent && m.has(k)) return false;
      m.set(k, v);
      ttls.set(k, ttl);
      return true;
    },
  };
  return { kv, m, ttls };
}

describe("KvFlagDefinitionCache", () => {
  it("the lock winner fetches and publishes; the loser reads the stored copy", async () => {
    const { kv, ttls } = memoryKv();
    const a = new KvFlagDefinitionCache(kv, { prefix: "t", ttlSeconds: 60, lockSeconds: 5 });
    const b = new KvFlagDefinitionCache(kv, { prefix: "t" });
    expect(await a.shouldFetchFlagDefinitions()).toBe(true);
    expect(await b.shouldFetchFlagDefinitions()).toBe(false);
    expect(await b.getFlagDefinitions()).toBeUndefined(); // nothing published yet: the loser fetches itself
    await a.onFlagDefinitionsReceived([flag("on")]);
    expect((await b.getFlagDefinitions())?.map((f) => f.key)).toEqual(["on"]);
    expect(ttls.get("t:defs")).toBe(60);
    expect(ttls.get("t:lock")).toBe(5);
  });

  it("an unparsable stored copy reads as nothing cached", async () => {
    const { kv, m } = memoryKv();
    m.set("lucida:flags:defs", "{oops");
    expect(await new KvFlagDefinitionCache(kv).getFlagDefinitions()).toBeUndefined();
    m.set("lucida:flags:defs", '{"not":"a list"}');
    expect(await new KvFlagDefinitionCache(kv).getFlagDefinitions()).toBeUndefined();
  });

  it("adapts ioredis and node-redis call shapes without importing either", async () => {
    const calls: unknown[][] = [];
    const redis = { get: () => null, set: (...a: unknown[]) => (calls.push(a), "OK") };
    await redisFlagDefinitionCache(redis, "ioredis", { prefix: "p", lockSeconds: 7 }).shouldFetchFlagDefinitions();
    await redisFlagDefinitionCache(redis, "node-redis", { prefix: "p", lockSeconds: 7 }).shouldFetchFlagDefinitions();
    expect(calls).toEqual([
      ["p:lock", "1", "EX", 7, "NX"],
      ["p:lock", "1", { EX: 7, NX: true }],
    ]);
    const nil = { get: () => null, set: () => null }; // SET NX that lost the race replies nil
    expect(await redisFlagDefinitionCache(nil).shouldFetchFlagDefinitions()).toBe(false);
  });

  it("two workers share one definitions fetch through the client", async () => {
    const { kv } = memoryKv();
    const g1 = fakeGateway({ defs: [flag("on")] });
    const g2 = fakeGateway({ defs: [flag("on")] });
    const mk = (g: ReturnType<typeof fakeGateway>) =>
      new Lucida("lc_pk_x", {
        host: "http://gw", fetch: g.fetch, secretKey: "lc_sk_x", flushAt: 1000, streamFlags: false,
        flagDefinitionCacheProvider: new KvFlagDefinitionCache(kv),
      });
    const first = mk(g1);
    await first.ready;
    const second = mk(g2);
    await second.ready;
    const defsCalls = (g: ReturnType<typeof fakeGateway>) => g.reqs.filter((r) => r.url.endsWith("/v1/flags/definitions")).length;
    expect(defsCalls(g1)).toBe(1);
    expect(defsCalls(g2)).toBe(0);
    expect(await second.getFeatureFlag("on", "u")).toBe(true);
    await first.shutdown();
    await second.shutdown();
  });
});

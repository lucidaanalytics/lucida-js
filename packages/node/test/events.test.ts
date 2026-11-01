import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Lucida } from "../src/index.js";
import { fakeGateway } from "./helpers.js";

const mk = (g: ReturnType<typeof fakeGateway>, o = {}) =>
  new Lucida("lc_pk_x", { host: "http://gw", fetch: g.fetch, flushAt: 100, ...o });

describe("events", () => {
  it("captures with explicit distinctId and flushes on shutdown", async () => {
    const g = fakeGateway();
    const l = mk(g);
    l.capture({ distinctId: "u1", event: "buy", properties: { n: 1 }, groups: { company: "acme" } });
    expect(g.reqs).toHaveLength(0);
    await l.shutdown();
    const e = g.events()[0]!;
    expect(e).toMatchObject({ event: "buy", distinct_id: "u1", $groups: { company: "acme" } });
    expect(e.properties).toMatchObject({ n: 1, $lib: "lucida-node" });
    expect(g.reqs[0]?.url).toBe("http://gw/v1/batch");
    expect((g.reqs[0]?.body as { api_key: string }).api_key).toBe("lc_pk_x");
  });

  it("flushes when flushAt is reached", async () => {
    const g = fakeGateway();
    const l = mk(g, { flushAt: 2 });
    l.capture({ distinctId: "u", event: "a" });
    l.capture({ distinctId: "u", event: "b" });
    await l.flush();
    expect(g.events().map((e) => e.event)).toEqual(["a", "b"]);
    await l.shutdown();
  });

  it("identify, alias and groupIdentify produce the wire events", async () => {
    const g = fakeGateway();
    const l = mk(g);
    l.identify({ distinctId: "u1", properties: { plan: "pro" }, propertiesSetOnce: { first: 1 } });
    l.alias({ distinctId: "u1", alias: "u1-old" });
    l.groupIdentify({ groupType: "company", groupKey: "acme", properties: { size: 5 } });
    await l.shutdown();
    const [i, a, gi] = g.events();
    expect(i).toMatchObject({ event: "$identify", $set: { plan: "pro" }, $set_once: { first: 1 } });
    expect(a).toMatchObject({ event: "$create_alias", properties: { alias: "u1-old", distinct_id: "u1" } });
    expect(gi).toMatchObject({
      event: "$groupidentify",
      distinct_id: "$company_acme",
      properties: { $group_type: "company", $group_key: "acme", $group_set: { size: 5 } },
    });
  });

  it("gzips bodies over 1 KB and flags the URL", async () => {
    const g = fakeGateway();
    const l = mk(g);
    l.capture({ distinctId: "u", event: "big", properties: { blob: "x".repeat(3000) } });
    await l.shutdown();
    const r = g.reqs[0]!;
    expect(r.url).toBe("http://gw/v1/batch?compression=gzip");
    expect(r.raw!.length).toBeLessThan(3000);
    expect(JSON.parse(gunzipSync(r.raw!).toString()).batch[0].properties.blob).toHaveLength(3000);
  });

  it("does not gzip small bodies", async () => {
    const g = fakeGateway();
    const l = mk(g);
    l.capture({ distinctId: "u", event: "small" });
    await l.shutdown();
    expect(g.reqs[0]?.url).toBe("http://gw/v1/batch");
  });

  it("disabled does nothing", async () => {
    const g = fakeGateway();
    const l = mk(g, { disabled: true, secretKey: "lc_sk_x" });
    l.capture({ distinctId: "u", event: "a" });
    expect(await l.getFeatureFlag("f", "u")).toBeUndefined();
    await l.shutdown();
    expect(g.reqs).toHaveLength(0);
  });

  it("importEvents posts to /v1/s2s/batch with the secret key and original timestamps", async () => {
    const g = fakeGateway();
    const l = mk(g, { secretKey: "lc_sk_x" });
    const n = await l.importEvents([
      { distinctId: "u1", event: "old", timestamp: "2024-01-02T03:04:05.000Z" },
      { distinctId: "u2", event: "older", timestamp: new Date("2023-05-06T00:00:00Z") },
    ]);
    expect(n).toBe(2);
    const r = g.reqs.find((x) => x.url.includes("s2s"))!;
    expect(r.headers.Authorization).toBe("Bearer lc_sk_x");
    expect(g.events().map((e) => e.timestamp)).toEqual(["2024-01-02T03:04:05.000Z", "2023-05-06T00:00:00.000Z"]);
    await l.shutdown();
  });

  it("importEvents chunks at 1000 and needs a secret key", async () => {
    const g = fakeGateway();
    const l = mk(g, { secretKey: "lc_sk_x" });
    await l.importEvents(Array.from({ length: 1500 }, (_, i) => ({ distinctId: `u${i}`, event: "e" })));
    expect(g.reqs.filter((r) => r.url.includes("s2s"))).toHaveLength(2);
    await expect(mk(g).importEvents([])).rejects.toThrow(/secretKey/);
    await l.shutdown();
  });

  it("importEvents throws on a rejected chunk", async () => {
    const l = new Lucida("k", { host: "http://gw", secretKey: "s", fetch: (async () => new Response("", { status: 401 })) as typeof fetch });
    await expect(l.importEvents([{ distinctId: "u", event: "e" }])).rejects.toThrow(/401/);
    await l.shutdown();
  });
});

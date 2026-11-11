import { describe, expect, it } from "vitest";
import { Lucida } from "../src/index.js";
import { fakeGateway } from "./helpers.js";

const mk = (g: ReturnType<typeof fakeGateway>, o = {}) =>
  new Lucida("lc_pk_x", { host: "http://gw", fetch: g.fetch, flushAt: 100, ...o });

describe("person properties and dedupe (LC-ING-41)", () => {
  it("sends $set / $set_once events", async () => {
    const g = fakeGateway();
    const l = mk(g);
    l.setPersonProperties({ distinctId: "u", properties: { plan: "pro" } });
    l.setPersonPropertiesOnce({ distinctId: "u", properties: { first: "x" } });
    await l.shutdown();
    const [a, b] = g.events();
    expect(a).toMatchObject({ event: "$set", $set: { plan: "pro" } });
    expect(b).toMatchObject({ event: "$set", $set_once: { first: "x" } });
  });

  it("skips identical identify and groupIdentify calls", async () => {
    const g = fakeGateway();
    const l = mk(g);
    for (let i = 0; i < 3; i++) {
      l.identify({ distinctId: "u", properties: { a: 1 } });
      l.groupIdentify({ groupType: "org", groupKey: "acme", properties: { n: 1 } });
    }
    l.identify({ distinctId: "u", properties: { a: 2 } });
    await l.shutdown();
    expect(g.events().map((e) => e.event)).toEqual(["$identify", "$groupidentify", "$identify"]);
  });
});

describe("captureImmediate retry (G79)", () => {
  it("retries 5xx up to the attempt cap and then reports", async () => {
    let calls = 0;
    const errors: Error[] = [];
    const f = (async () => {
      calls++;
      return new Response("", { status: 503 });
    }) as typeof fetch;
    const l = new Lucida("lc_pk_x", { host: "http://gw", fetch: f, immediateRetryDelayMs: 1, onError: (e) => errors.push(e) });
    expect(await l.captureImmediate({ distinctId: "u", event: "e" })).toBeUndefined();
    expect(calls).toBe(3);
    expect(errors).toHaveLength(1);
    await l.shutdown();
  });

  it("succeeds on a later attempt and never retries a 400", async () => {
    let calls = 0;
    const f = (async () => new Response("", { status: ++calls < 2 ? 500 : 200 })) as typeof fetch;
    const l = new Lucida("lc_pk_x", { host: "http://gw", fetch: f, immediateRetryDelayMs: 1 });
    expect(await l.captureImmediate({ distinctId: "u", event: "e" })).toBeTypeOf("string");
    expect(calls).toBe(2);
    calls = 0;
    const bad = new Lucida("lc_pk_x", {
      host: "http://gw",
      fetch: (async () => {
        calls++;
        return new Response("", { status: 400 });
      }) as typeof fetch,
    });
    expect(await bad.captureImmediate({ distinctId: "u", event: "e" })).toBeUndefined();
    expect(calls).toBe(1);
  });
});

describe("defaultProperties and maxQueueSize (LC-DX-68)", () => {
  it("merges default properties and bounds the queue", async () => {
    const g = fakeGateway();
    const l = mk(g, { defaultProperties: { app: "a" }, maxQueueSize: 2, flushAt: 100 });
    for (let i = 0; i < 4; i++) l.capture({ distinctId: "u", event: `e${i}` });
    await l.shutdown();
    const ev = g.events();
    expect(ev).toHaveLength(2);
    expect(ev[0]?.properties.app).toBe("a");
  });

  it("re-sends an identical identify after its batch failed", async () => {
    const g = fakeGateway();
    let calls = 0;
    const flaky = ((u: string, init?: RequestInit) =>
      /\/v1\/batch/.test(String(u)) && ++calls === 1 ? Promise.resolve(new Response("", { status: 400 })) : g.fetch(u, init)) as typeof fetch;
    const errors: unknown[] = [];
    const l = mk(g, { fetch: flaky, onError: (e: unknown) => errors.push(e) });
    l.identify({ distinctId: "u", properties: { a: 1 } });
    l.groupIdentify({ groupType: "org", groupKey: "acme", properties: { n: 1 } });
    await l.flush();
    expect(errors).toHaveLength(1);
    l.identify({ distinctId: "u", properties: { a: 1 } });
    l.groupIdentify({ groupType: "org", groupKey: "acme", properties: { n: 1 } });
    await l.shutdown();
    expect(g.events().map((e) => e.event)).toEqual(["$identify", "$groupidentify"]);
  });

  it("importEvents applies defaults and beforeSend unless raw; registerOnce keeps set values", async () => {
    const g = fakeGateway();
    const l = mk(g, {
      secretKey: "lc_sk_x",
      defaultProperties: { env: "prod" },
      beforeSend: (e: { event: string; properties: Record<string, unknown> }) => (e.event === "drop" ? null : { ...e, properties: { ...e.properties, hooked: 1 } }),
    });
    l.registerOnce({ env: "dev", region: "eu" });
    l.registerOnce({ region: "us" });
    await l.importEvents([
      { distinctId: "u", event: "keep" },
      { distinctId: "u", event: "drop" },
    ]);
    await l.importEvents([{ distinctId: "u", event: "plain" }], { raw: true });
    const [a, b] = g.events() as [Record<string, any>, Record<string, any>]; // eslint-disable-line
    expect(g.events()).toHaveLength(2);
    expect(a.properties).toMatchObject({ env: "prod", region: "eu", hooked: 1 });
    expect(b.properties.hooked).toBeUndefined();
    expect(b.properties.env).toBeUndefined();
    await l.shutdown();
  });
});

import { describe, expect, it, vi } from "vitest";
import { Lucida } from "../src/index.js";
import { fakeGateway, flag } from "./helpers.js";

const mk = (g: ReturnType<typeof fakeGateway>, o = {}) =>
  new Lucida("lc_pk_x", { host: "http://gw", fetch: g.fetch, secretKey: "lc_sk_x", flushAt: 1000, streamFlags: false, ...o });

describe("flag values on captured events", () => {
  it("sendFeatureFlags evaluates locally and attaches $feature/* without overwriting", async () => {
    const lc = new Lucida("lc_pk_x", { testMode: { fixture: [flag("on"), flag("off", { conditions: [{ rollout_pct: 0 }] })] } });
    lc.capture({ distinctId: "u", event: "buy", properties: { "$feature/on": "mine" }, sendFeatureFlags: true });
    const p = lc.captured.at(-1)!.properties;
    expect(p["$feature/on"]).toBe("mine");
    expect(p["$feature/off"]).toBe(false);
    expect(p.$active_feature_flags).toEqual(["on"]);
    expect(lc.captured.some((e) => e.event === "$exposure")).toBe(false);
  });

  it("falls back to one remote request before definitions load", async () => {
    const g = fakeGateway({ defsStatus: 503, remote: { flags: { r: { enabled: true, value: "B", variant: "B" } } } });
    const l = mk(g);
    await l.ready;
    l.capture({ distinctId: "u", event: "buy", sendFeatureFlags: true });
    await vi.waitFor(() => expect(g.reqs.filter((r) => r.url.endsWith("/v1/flags"))).toHaveLength(1));
    await vi.waitFor(async () => {
      await l.flush();
      expect(g.events().find((e) => e.event === "buy")?.properties["$feature/r"]).toBe("B");
    });
    await l.shutdown();
  });

  it("events captured after a remote-flag capture are delivered behind it", async () => {
    const g = fakeGateway({ defsStatus: 503, remote: { flags: { r: { enabled: true, value: "B", variant: "B" } } } });
    const l = mk(g);
    await l.ready;
    l.capture({ distinctId: "u", event: "first", sendFeatureFlags: true });
    l.capture({ distinctId: "u", event: "second" });
    await l.flush();
    expect(g.events().map((e) => e.event)).toEqual(["first", "second"]);
    await l.shutdown();
  });

  it("evaluateFlags snapshot: reads without exposures, onlyAccessed narrows the capture", async () => {
    const lc = new Lucida("lc_pk_x", { testMode: { fixture: [flag("a"), flag("b"), flag("j", { type: "json", payload: { x: 1 } })] } });
    const snap = await lc.evaluateFlags("u");
    expect(snap.isEnabled("a")).toBe(true);
    expect(snap.getPayload("j")).toEqual({ x: 1 });
    lc.capture({ distinctId: "u", event: "e1", flags: snap.onlyAccessed() });
    lc.capture({ distinctId: "u", event: "e2", flags: snap.only(["b"]) });
    const [e1, e2] = lc.captured.filter((e) => e.event.startsWith("e"));
    expect(e1!.properties.$active_feature_flags).toEqual(["a"]);
    expect(e2!.properties).toHaveProperty("$feature/b", true);
    expect(e2!.properties).not.toHaveProperty("$feature/a");
    expect(lc.captured.some((e) => e.event === "$feature_flag_called")).toBe(false);
  });
});

describe("cold start, app contexts and quota", () => {
  it("getFeatureFlag returns defaultValue when nothing decides the flag", async () => {
    const g = fakeGateway({ defsStatus: 503, remote: { flags: {}, quota_limited: true } });
    const l = mk(g);
    await l.ready;
    expect(await l.getFeatureFlag("new-ui", "u", { defaultValue: "control" })).toBe("control");
    await l.shutdown();
  });

  it("local evaluation drops flags limited to other app contexts and sends the contexts remotely", async () => {
    const lc = new Lucida("lc_pk_x", { appContexts: ["api"], testMode: { fixture: [flag("all"), flag("web", { app_contexts: ["web"] })] } });
    expect(await lc.getAllFlags("u")).toEqual({ all: true });
    expect(await lc.getAllFlags("u", { appContexts: ["web"] })).toEqual({ all: true, web: true });
    const g = fakeGateway({ defsStatus: 503 });
    const l = mk(g, { appContexts: ["api"] });
    await l.ready;
    await l.getFeatureFlag("x", "u");
    expect(g.reqs.find((r) => r.url.endsWith("/v1/flags"))!.body).toMatchObject({ app_contexts: ["api"] });
    await l.getFeatureFlag("x", "u", { anonDistinctId: "anon-1" });
    expect(g.reqs.filter((r) => r.url.endsWith("/v1/flags")).at(-1)!.body).toMatchObject({ distinct_id: "u", anon_distinct_id: "anon-1" });
    await l.shutdown();
  });
});

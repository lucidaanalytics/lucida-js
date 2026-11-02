import { describe, expect, it } from "vitest";
import { Lucida } from "../src/index.js";
import { fakeGateway, flag } from "./helpers.js";

const mk = (g: ReturnType<typeof fakeGateway>, o = {}) =>
  new Lucida("lc_pk_x", { host: "http://gw", fetch: g.fetch, streamFlags: false, flushAt: 1000, ...o });

describe("fallbacks and getFeatureFlagDetails", () => {
  it("serves the fallback for a missing flag with reason fallback and no exposure", async () => {
    const g = fakeGateway({ remote: { flags: {} } });
    const lc = mk(g, { fallbacks: { gone: "safe" } });
    expect(await lc.getFeatureFlagDetails("gone", "u")).toMatchObject({ value: "safe", reason: "fallback", conditionIndex: -1 });
    expect(await lc.getFeatureFlag("gone", "u", { defaultValue: "def" })).toBe("safe");
    await lc.flush();
    expect(g.events().some((e) => e.event === "$exposure")).toBe(false);
  });

  it("serves the fallback when the network fails, and the old behaviour without one", async () => {
    const failing = (async () => new Response("", { status: 500 })) as typeof fetch;
    const lc = new Lucida("lc_pk_x", { host: "http://gw", fetch: failing, fallbacks: { f: true } });
    expect(await lc.getFeatureFlag("f", "u")).toBe(true);
    expect(await lc.getFeatureFlag("other", "u", { defaultValue: "d" })).toBe("d");
    expect(await lc.getFeatureFlagDetails("other", "u")).toBeUndefined();
  });

  it("reports the real reason and request id for served flags", async () => {
    const g = fakeGateway({
      remote: { request_id: "r1", flags: { s: { enabled: true, value: true, reason: "condition_match", condition_index: 2 } } },
    });
    const lc = mk(g, { fallbacks: { s: false } });
    expect(await lc.getFeatureFlagDetails("s", "u")).toMatchObject({
      value: true,
      reason: "condition_match",
      conditionIndex: 2,
      requestId: "r1",
      evaluatedLocally: false,
    });
  });

  it("local evaluation carries its reason", async () => {
    const lc = new Lucida("lc_pk_x", { testMode: { fixture: [flag("on")] }, fallbacks: { missing: 1 as never } });
    expect(await lc.getFeatureFlagDetails("on", "u", { sendExposure: false })).toMatchObject({
      value: true,
      reason: "condition_match",
      evaluatedLocally: true,
    });
  });
});

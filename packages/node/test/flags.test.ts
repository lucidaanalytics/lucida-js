import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvalContext, FlagDefinition } from "@lucida-analytics/sdk-core";
import { Lucida } from "../src/index.js";
import { LruSet } from "../src/lru.js";
import { fakeGateway, flag } from "./helpers.js";

const mk = (g: ReturnType<typeof fakeGateway>, o = {}) =>
  new Lucida("lc_pk_x", { host: "http://gw", fetch: g.fetch, secretKey: "lc_sk_x", flushAt: 1000, ...o });

afterEach(() => vi.useRealTimers());

describe("local evaluation", () => {
  it("evaluates locally without calling /v1/flags", async () => {
    const g = fakeGateway({ defs: [flag("on"), flag("pro", { conditions: [{ rollout_pct: 100, filters: [{ type: "person", key: "plan", op: "eq", value: "pro" }] }] })] });
    const l = mk(g);
    await l.ready;
    expect(await l.getFeatureFlag("on", "u1")).toBe(true);
    expect(await l.getFeatureFlag("pro", "u1", { personProperties: { plan: "pro" } })).toBe(true);
    expect(await l.getFeatureFlag("pro", "u1", { personProperties: { plan: "free" } })).toBe(false);
    expect(await l.isFeatureEnabled("pro", "u1")).toBe(false);
    expect(g.reqs.some((r) => r.url.endsWith("/v1/flags"))).toBe(false);
    expect(g.reqs[0]?.headers.Authorization).toBe("Bearer lc_sk_x");
    await l.shutdown();
  });

  it("getAllFlags and payloads", async () => {
    const g = fakeGateway({ defs: [flag("a"), flag("j", { type: "json", payload: { x: 1 } })] });
    const l = mk(g);
    await l.ready;
    expect(await l.getAllFlags("u")).toEqual({ a: true, j: true });
    expect(await l.getFeatureFlagPayload("j", "u")).toEqual({ x: 1 });
    await l.shutdown();
  });

  it("polls with If-None-Match and keeps definitions on 304", async () => {
    vi.useFakeTimers();
    const g = fakeGateway({ defs: [flag("a")], etag: '"v1"' });
    const l = mk(g, { featureFlagsPollingIntervalMs: 30_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(g.reqs[0]?.headers["If-None-Match"]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    const polls = g.reqs.filter((r) => r.url.includes("definitions"));
    expect(polls).toHaveLength(2);
    expect(polls[1]?.headers["If-None-Match"]).toBe('"v1"');
    expect(await l.getFeatureFlag("a", "u")).toBe(true);
    g.state.etag = '"v2"';
    g.state.defs = [flag("a", { active: false })];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await l.getFeatureFlag("a", "u")).toBe(false);
    await l.shutdown();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(g.reqs.filter((r) => r.url.includes("definitions"))).toHaveLength(3);
  });

  it("keeps old definitions when a poll fails", async () => {
    const g = fakeGateway({ defs: [flag("a")] });
    const l = mk(g);
    await l.ready;
    g.state.defsStatus = 500;
    await l.reloadFeatureFlags();
    expect(await l.getFeatureFlag("a", "u", { onlyEvaluateLocally: true })).toBe(true);
    await l.shutdown();
  });
});

describe("remote fallback", () => {
  const cohort = flag("c", { conditions: [{ rollout_pct: 100, filters: [{ type: "cohort", key: "c1", op: "in" }] }] });

  it("falls back to /v1/flags on requires_server", async () => {
    const g = fakeGateway({ defs: [cohort], remote: { request_id: "r1", flags: { c: { enabled: true, value: true, payload: { p: 1 } } } } });
    const l = mk(g);
    await l.ready;
    expect(await l.getFeatureFlag("c", "u", { personProperties: { a: 1 } })).toBe(true);
    const r = g.reqs.find((x) => x.url.endsWith("/v1/flags"))!;
    expect(r.body).toMatchObject({ api_key: "lc_pk_x", distinct_id: "u", person_properties: { a: 1 }, flag_keys: ["c"] });
    await l.flush();
    expect(g.events().find((e) => e.event === "$feature_flag_called")?.properties).toMatchObject({
      locally_evaluated: false,
      $feature_flag_request_id: "r1",
    });
    expect(await l.getFeatureFlagPayload("c", "u")).toEqual({ p: 1 });
    await l.shutdown();
  });

  it("onlyEvaluateLocally never calls the server", async () => {
    const g = fakeGateway({ defs: [cohort] });
    const l = mk(g);
    await l.ready;
    expect(await l.getFeatureFlag("c", "u", { onlyEvaluateLocally: true })).toBeUndefined();
    expect(await l.getFeatureFlag("nope", "u", { onlyEvaluateLocally: true })).toBeUndefined();
    expect(g.reqs.some((r) => r.url.endsWith("/v1/flags"))).toBe(false);
    await l.shutdown();
  });

  it("uses remote for unknown flags and when no secret key is set", async () => {
    const g = fakeGateway({ remote: { flags: { v: { enabled: true, variant: "b", value: "b" } } } });
    const l = new Lucida("lc_pk_x", { host: "http://gw", fetch: g.fetch });
    expect(await l.getFeatureFlag("v", "u")).toBe("b");
    expect(g.reqs.some((r) => r.url.includes("definitions"))).toBe(false);
    await l.shutdown();
  });

  it("getAllFlags merges remote results for undecidable flags", async () => {
    const g = fakeGateway({ defs: [flag("a"), cohort], remote: { flags: { c: { enabled: true, value: true }, a: { value: false } } } });
    const l = mk(g);
    await l.ready;
    expect(await l.getAllFlags("u")).toEqual({ a: true, c: true });
    await l.shutdown();
  });

  it("returns undefined when the server fails", async () => {
    const l = new Lucida("k", { host: "http://gw", fetch: (async () => new Response("", { status: 503 })) as typeof fetch });
    expect(await l.getFeatureFlag("x", "u")).toBeUndefined();
    await l.shutdown();
  });
});

describe("exposure", () => {
  it("dedupes $feature_flag_called per (distinctId, flag, value)", async () => {
    const g = fakeGateway({ defs: [flag("a")] });
    const l = mk(g);
    await l.ready;
    await l.getFeatureFlag("a", "u1");
    await l.getFeatureFlag("a", "u1");
    await l.getFeatureFlag("a", "u2");
    await l.getFeatureFlag("a", "u3", { sendExposure: false });
    await l.shutdown();
    const called = g.events().filter((e) => e.event === "$feature_flag_called");
    expect(called.map((e) => e.distinct_id)).toEqual(["u1", "u2"]);
    expect(called[0]?.properties).toMatchObject({ $feature_flag: "a", $feature_flag_response: true, locally_evaluated: true });
    expect(g.events().filter((e) => e.event === "$exposure")).toHaveLength(2);
  });

  it("re-reports when the value changes and skips payload/getAll reads", async () => {
    const g = fakeGateway({ defs: [flag("a")] });
    const l = mk(g);
    await l.ready;
    await l.getFeatureFlag("a", "u");
    await l.getFeatureFlagPayload("a", "u");
    await l.getAllFlags("u");
    g.state.defs = [flag("a", { active: false })];
    await l.reloadFeatureFlags();
    await l.getFeatureFlag("a", "u");
    await l.shutdown();
    expect(g.events().filter((e) => e.event === "$feature_flag_called")).toHaveLength(2);
  });

  it("LruSet is bounded and refreshes recency", () => {
    const s = new LruSet(2);
    expect(s.add("a")).toBe(true);
    s.add("b");
    expect(s.add("a")).toBe(false); // refresh a; b is now oldest
    s.add("c"); // evicts b
    expect(s.size).toBe(2);
    expect(s.add("b")).toBe(true);
  });
});

describe("shared conformance vectors", () => {
  const flagsDir = process.env.LUCIDA_TESTDATA ? `file://${process.env.LUCIDA_TESTDATA}/flags/` : new URL("../../../testdata/flags/", import.meta.url).href;
  type Vec = { name: string; flag: string; context: EvalContext & Record<string, unknown>; expected: { value: unknown; payload?: unknown; reason: string } };
  const load = (f: string) =>
    JSON.parse(readFileSync(new URL(f, flagsDir), "utf8")) as { flags: FlagDefinition[]; vectors: Vec[] };

  for (const file of ["vectors_basic.json", "vectors.json", "vectors_g10.json"]) {
    it(`reproduces ${file} through the client`, async () => {
      const { flags, vectors } = load(file);
      const g = fakeGateway({ defs: flags });
      const l = mk(g);
      await l.ready;
      let checked = 0;
      const supported = vectors.filter((v) => !v.context.device_id); // device_id is local-only context; no vector depends on the wire form
      for (const v of supported.slice(0, 1500)) {
        const o = {
          onlyEvaluateLocally: true,
          sendExposure: false,
          ...(v.context.groups ? { groups: v.context.groups } : {}),
          ...(v.context.person_properties ? { personProperties: v.context.person_properties } : {}),
          ...(v.context.group_properties ? { groupProperties: v.context.group_properties } : {}),
          ...(v.context.device_properties ? { deviceProperties: v.context.device_properties } : {}),
          ...(v.context.geo_properties ? { geoProperties: v.context.geo_properties } : {}),
          ...(v.context.app_version ? { appVersion: v.context.app_version } : {}),
          ...(v.context.bucketing_key ? { bucketingKey: v.context.bucketing_key } : {}),
        };
        const got = await l.getFeatureFlag(v.flag, v.context.distinct_id, o);
        if (v.expected.reason === "requires_server") expect(got, v.name).toBeUndefined();
        else {
          expect(got, v.name).toBe(v.expected.value);
          expect(await l.getFeatureFlagPayload(v.flag, v.context.distinct_id, o), v.name).toEqual(v.expected.payload);
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(10);
      await l.shutdown();
    }, 30_000);
  }
});

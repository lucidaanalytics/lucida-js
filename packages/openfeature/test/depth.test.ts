import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LucidaServerProvider, LucidaWebProvider, REASONS, mapReason } from "../src/index.js";
import type { FlagsListener, LucidaDetails, ServerClient } from "../src/index.js";

const table = new URL("../../../testdata/openfeature/reasons.json", import.meta.url);

describe("reason table", () => {
  it.skipIf(!existsSync(table))("matches testdata/openfeature/reasons.json", () => {
    const shared = JSON.parse(readFileSync(table, "utf8")).reasons as Record<string, { reason: string; variant_reason?: string }>;
    for (const [raw, want] of Object.entries(shared)) {
      if (raw === "") continue;
      expect(mapReason(raw, true), raw).toBe(want.reason);
      if (want.variant_reason) expect(mapReason(raw, "v"), raw).toBe(want.variant_reason);
    }
    expect(Object.keys(REASONS).sort()).toEqual(Object.keys(shared).filter(Boolean).sort());
    expect(mapReason("???", true)).toBe("UNKNOWN");
    expect(mapReason(undefined, true)).toBe("UNKNOWN");
  });
});

function fakeServer(details: Record<string, LucidaDetails>) {
  const captured: unknown[] = [];
  const seen: unknown[] = [];
  let listener: FlagsListener | undefined;
  const client: ServerClient = {
    getFeatureFlag: async () => undefined,
    getFeatureFlagPayload: async () => undefined,
    getFeatureFlagDetails: async (k, _id, o) => (seen.push(o), details[k]),
    onFlagsChange: (l) => ((listener = l), () => undefined),
    capture: (i) => void captured.push(i),
  };
  return { client, captured, seen, listener: () => listener! };
}

describe("LucidaServerProvider depth", () => {
  const ctx = { targetingKey: "u1", plan: "pro", groups: { company: "acme" }, groupProperties: { company: { size: 9 } } };

  it("maps fallback to DEFAULT without an error code and carries flagMetadata", async () => {
    const f = fakeServer({
      fb: { value: "safe", reason: "fallback", conditionIndex: -1 },
      hit: { value: true, reason: "condition_match", conditionIndex: 1, requestId: "r1", evaluatedLocally: true },
    });
    const p = new LucidaServerProvider(f.client);
    const fb = await p.resolveStringEvaluation("fb", "d", ctx);
    expect(fb).toMatchObject({ value: "safe", reason: "DEFAULT", flagMetadata: { lucidaReason: "fallback", evaluatedLocally: false } });
    expect(fb.errorCode).toBeUndefined();
    expect(fb.flagMetadata).not.toHaveProperty("conditionIndex");
    expect(await p.resolveBooleanEvaluation("hit", false, ctx)).toMatchObject({
      value: true,
      reason: "TARGETING_MATCH",
      flagMetadata: { lucidaReason: "condition_match", conditionIndex: 1, requestId: "r1", evaluatedLocally: true },
    });
    expect(await p.resolveBooleanEvaluation("gone", true, ctx)).toMatchObject({ value: true, reason: "ERROR", errorCode: "FLAG_NOT_FOUND" });
  });

  it("passes the full context", async () => {
    const f = fakeServer({ x: { value: true, reason: "condition_match" } });
    await new LucidaServerProvider(f.client).resolveBooleanEvaluation("x", false, ctx);
    expect(f.seen[0]).toEqual({ personProperties: { plan: "pro" }, groups: { company: "acme" }, groupProperties: { company: { size: 9 } } });
  });

  it("track maps to capture", () => {
    const f = fakeServer({});
    new LucidaServerProvider(f.client).track("purchase", ctx, { value: 9.5, sku: "a" });
    expect(f.captured).toEqual([{ distinctId: "u1", event: "purchase", properties: { sku: "a", $value: 9.5 }, groups: { company: "acme" } }]);
  });

  it("emits change, stale and recovery events; the first load is silent", () => {
    const f = fakeServer({});
    const p = new LucidaServerProvider(f.client);
    const got: string[] = [];
    for (const t of ["PROVIDER_READY", "PROVIDER_CONFIGURATION_CHANGED", "PROVIDER_STALE", "PROVIDER_ERROR"] as const) {
      p.events.addHandler(t, () => void got.push(t));
    }
    const l = f.listener();
    l.changed();
    l.changed();
    l.stale(new Error("down"));
    l.stale();
    l.changed();
    expect(got).toEqual(["PROVIDER_CONFIGURATION_CHANGED", "PROVIDER_STALE", "PROVIDER_READY"]);
  });

  it("first failure is PROVIDER_ERROR", () => {
    const f = fakeServer({});
    const p = new LucidaServerProvider(f.client);
    const got: string[] = [];
    p.events.addHandler("PROVIDER_ERROR", (d) => void got.push(d?.message ?? ""));
    f.listener().stale(new Error("boom"));
    expect(got).toEqual(["boom"]);
  });
});

describe("LucidaWebProvider depth", () => {
  const base = { identify: () => undefined, reset: () => undefined, getFlag: () => undefined, getFlagPayload: () => undefined };

  it("uses details for reasons and degrades without them", () => {
    const withDetails = new LucidaWebProvider({
      ...base,
      reloadFlags: async () => undefined,
      getFeatureFlagDetails: (k) => (k === "f" ? { value: "A", reason: "condition_match", conditionIndex: 0 } : undefined),
    });
    expect(withDetails.resolveStringEvaluation("f", "d")).toMatchObject({ value: "A", reason: "SPLIT", variant: "A" });
    const plain = new LucidaWebProvider({ ...base, getFlag: () => true, reloadFlags: async () => undefined });
    expect(plain.resolveBooleanEvaluation("x", false)).toMatchObject({ value: true, reason: "UNKNOWN" });
  });

  it("applies groups and person properties, emits CONFIGURATION_CHANGED and STALE, tracks", async () => {
    const calls: string[] = [];
    let cb: () => void = () => undefined;
    let fail = false;
    const p = new LucidaWebProvider({
      ...base,
      identify: (id) => void calls.push(`identify ${id}`),
      reloadFlags: async () => {
        if (fail) throw new Error("net");
      },
      onFeatureFlags: (f) => ((cb = f), () => undefined),
      group: (t, k) => void calls.push(`group ${t}=${k}`),
      setPersonProperties: (s) => void calls.push(`set ${JSON.stringify(s)}`),
      capture: (e, props) => void calls.push(`capture ${e} ${JSON.stringify(props)}`),
    });
    const got: string[] = [];
    for (const t of ["PROVIDER_CONFIGURATION_CHANGED", "PROVIDER_STALE"] as const) p.events.addHandler(t, () => void got.push(t));
    await p.initialize({ targetingKey: "u1", plan: "pro", groups: { company: "acme" } });
    expect(calls).toEqual(["identify u1", "group company=acme", 'set {"plan":"pro"}']);
    cb();
    fail = true;
    await p.onContextChange({}, { targetingKey: "u2" }); // reload fails after a success: values kept, STALE
    expect(got).toEqual(["PROVIDER_CONFIGURATION_CHANGED", "PROVIDER_STALE"]);
    p.track("buy", {}, { value: 3, sku: "a" });
    expect(calls.at(-1)).toBe('capture buy {"sku":"a","$value":3}');
  });
});

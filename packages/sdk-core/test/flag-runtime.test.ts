import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RuntimeCounter, evaluateAll, mergePatch, resolveRuntime } from "../src/index.js";
import type { EvalContext, EvalResult, FlagDefinition, RuntimeEvents } from "../src/index.js";

const flagsDir = process.env.LUCIDA_TESTDATA ? `file://${process.env.LUCIDA_TESTDATA}/flags/` : new URL("../../../testdata/flags/", import.meta.url).href;
const v = JSON.parse(readFileSync(new URL("vectors_runtime.json", flagsDir), "utf8")) as {
  flags: FlagDefinition[];
  vectors: Array<{ name: string; flag: string; context: EvalContext; expected: EvalResult }>;
};

describe("shared flag vectors: vectors_runtime.json", () => {
  for (const vec of v.vectors) {
    it(vec.name, () => {
      expect(evaluateAll(v.flags, vec.context)[vec.flag]).toEqual(vec.expected);
    });
  }

  it("a resolved server result equals a full evaluation with the same counts", () => {
    const counts: RuntimeEvents[] = [{}, { session: { signup: 1, x: 1 } }, { page: { view_item: 3 } }, { session: { purchase: 1 } }];
    for (const plan of ["pro", "free"]) {
      const base = { distinct_id: "u1", person_properties: { plan } };
      const server = evaluateAll(v.flags, base);
      for (const rt of counts) {
        const full = evaluateAll(v.flags, { ...base, runtime_events: rt });
        for (const [k, r] of Object.entries(server)) expect(resolveRuntime(r, rt)).toEqual(full[k]);
      }
    }
  });
});

describe("mergePatch", () => {
  it("merges, deletes on null and never mutates", () => {
    const base = { a: { b: 1, c: 2 }, d: 3 };
    expect(mergePatch(base, { a: { b: null }, e: [1] })).toEqual({ a: { c: 2 }, d: 3, e: [1] });
    expect(base.a.b).toBe(1);
    expect(mergePatch(base, "x")).toBe("x");
    expect(mergePatch(undefined, { a: { b: null, c: 1 } })).toEqual({ a: { c: 1 } });
  });
});

describe("RuntimeCounter", () => {
  it("counts per session and per page view", () => {
    const c = new RuntimeCounter();
    c.record("$pageview", "s1");
    c.record("view_item", "s1");
    c.record("view_item", "s1");
    expect(c.counts("s1")).toEqual({ session: { $pageview: 1, view_item: 2 }, page: { $pageview: 1, view_item: 2 } });
    c.record("$pageview", "s1");
    expect(c.counts("s1").page).toEqual({ $pageview: 1 });
    expect(c.counts("s1").session?.view_item).toBe(2);
    c.record("x", "s2");
    expect(c.counts("s2")).toEqual({ session: { x: 1 }, page: { x: 1 } });
    const restored = new RuntimeCounter(c.saved());
    expect(restored.counts("s2").session).toEqual({ x: 1 });
    expect(restored.counts("s3")).toEqual({ session: {}, page: {} });
  });
});

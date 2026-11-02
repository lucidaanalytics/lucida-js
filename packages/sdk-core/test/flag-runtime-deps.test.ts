import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RuntimeCounter, countKey, countedFilters, evaluateAll, eventPropsMatch, resolveRuntime, resolveRuntimeAll } from "../src/index.js";
import type { EvalContext, EvalResult, FlagDefinition, PropertyFilter, RuntimeEvents } from "../src/index.js";

const flagsDir = process.env.LUCIDA_TESTDATA ? `file://${process.env.LUCIDA_TESTDATA}/flags/` : new URL("../../../testdata/flags/", import.meta.url).href;
const v = JSON.parse(readFileSync(new URL("vectors_runtime_deps.json", flagsDir), "utf8")) as {
  flags: FlagDefinition[];
  vectors: Array<{ name: string; flag: string; context: EvalContext; expected: EvalResult }>;
};

const EP1 = 'purchase|[["plan","eq","pro"]]';

describe("shared flag vectors: vectors_runtime_deps.json", () => {
  for (const vec of v.vectors) {
    it(vec.name, () => {
      expect(evaluateAll(v.flags, vec.context)[vec.flag]).toEqual(vec.expected);
    });
  }

  it("resolving a server response (dependencies first) equals a full evaluation", () => {
    const server = evaluateAll(v.flags, { distinct_id: "u1" });
    const counts: RuntimeEvents[] = [
      {}, { session: { signup: 1 } }, { session: { signup: 1 }, page: { cta: 1 } }, { session: { x2: 1 } },
      { page: { cta: 1 } }, { session: { [EP1]: 2 } }, { session: { signup: 1, x2: 1 } },
    ];
    for (const rt of counts) {
      const full = evaluateAll(v.flags, { distinct_id: "u1", runtime_events: rt });
      expect(resolveRuntimeAll(server, rt)).toEqual(full);
    }
    // a single resolve cannot read other flags: the flip branch never passes
    expect(resolveRuntime(server.dep_prereq as EvalResult, { session: { signup: 1 } }).reason).toBe("prerequisite_failed");
  });
});

describe("event property filters", () => {
  const f = v.flags.find((x) => x.key === "ep_purchase")?.conditions[0]?.filters?.[0] as PropertyFilter;

  it("names the count like the Go evaluator", () => {
    expect(countKey(f)).toBe(EP1);
    expect(countKey({ type: "event", key: "x", op: "is_set" })).toBe("x");
  });

  it("matches event properties", () => {
    expect(eventPropsMatch(f, { plan: "pro" })).toBe(true);
    expect(eventPropsMatch(f, { plan: "free" })).toBe(false);
    expect(eventPropsMatch(f, {})).toBe(false);
  });

  it("counts matching events under the filter's key", () => {
    const filters = countedFilters(v.flags, {});
    expect(filters.map(countKey)).toContain(EP1);
    const c = new RuntimeCounter();
    c.record("purchase", "s1", { plan: "pro" }, [...filters, f]); // a repeated filter counts once
    c.record("purchase", "s1", { plan: "free" }, filters);
    expect(c.counts("s1").session).toEqual({ purchase: 2, [EP1]: 1 });
    c.record("purchase", "s1", { plan: "pro" }, filters);
    expect(evaluateAll(v.flags, { distinct_id: "u1", runtime_events: c.counts("s1") }).ep_purchase?.value).toBe(true);
  });

  it("finds property filters inside server branches", () => {
    const server = evaluateAll(v.flags, { distinct_id: "u1" });
    expect(countedFilters(undefined, server).map(countKey)).toEqual(expect.arrayContaining([EP1]));
  });
});

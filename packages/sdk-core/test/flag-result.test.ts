import { describe, expect, it } from "vitest";
import { FlagFreshness, flagResult } from "../src/index.js";

describe("flagResult", () => {
  it("derives enabled and variant from the value", () => {
    expect(flagResult("a", true, undefined, "condition_match")).toEqual({ key: "a", value: true, enabled: true, reason: "condition_match" });
    expect(flagResult("b", "B", { x: 1 }, "remote")).toEqual({ key: "b", value: "B", enabled: true, variant: "B", payload: { x: 1 }, reason: "remote" });
    expect(flagResult("c", false, undefined, "no_condition_match")).toMatchObject({ enabled: false, reason: "no_condition_match" });
    expect(flagResult("d", undefined, undefined, "remote")).toEqual({ key: "d", value: undefined, enabled: false, reason: "not_found" });
  });
});

describe("FlagFreshness", () => {
  it("is fresh only inside the TTL and for the same distinct id", () => {
    let t = 1000;
    const f = new FlagFreshness(500, () => t);
    expect(f.fresh("u")).toBe(false);
    f.mark("u");
    expect(f.fresh("u")).toBe(true);
    expect(f.fresh("other")).toBe(false);
    t += 499;
    expect(f.fresh("u")).toBe(true);
    t += 1;
    expect(f.fresh("u")).toBe(false);
  });

  it("no TTL never skips; clear and restore work", () => {
    const t = 0;
    const none = new FlagFreshness(undefined, () => t);
    none.mark("u");
    expect(none.fresh("u")).toBe(false);
    const f = new FlagFreshness(100, () => t);
    f.restore({ at: 0, id: "u" });
    expect(f.fresh("u")).toBe(true);
    f.clear();
    expect(f.fresh("u")).toBe(false);
    f.restore({ at: "x" as never, id: "u" });
    expect(f.fresh("u")).toBe(false);
  });
});

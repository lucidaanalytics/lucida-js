import { describe, expect, it } from "vitest";
import { FlagFreshness, fallbackValue, flagResult, withFallback } from "../src/index.js";

describe("fallbacks", () => {
  const fb = { a: "control", b: false };
  it("serves the fallback with reason fallback when nothing decided the flag", () => {
    expect(withFallback(flagResult("a", undefined, undefined, "remote"), fb)).toEqual({ key: "a", value: "control", enabled: true, variant: "control", reason: "fallback" });
    expect(withFallback(flagResult("b", false, undefined, "requires_server"), fb)).toMatchObject({ value: false, reason: "fallback" });
    expect(withFallback(flagResult("a", false, undefined, "prerequisite_cycle"), fb).reason).toBe("fallback");
  });
  it("keeps decided results and flags without a fallback", () => {
    expect(withFallback(flagResult("a", "test", undefined, "condition_match"), fb).value).toBe("test");
    expect(withFallback(flagResult("a", false, undefined, "no_condition_match"), fb).reason).toBe("no_condition_match");
    expect(withFallback(flagResult("z", undefined, undefined, "remote"), fb).reason).toBe("not_found");
    expect(withFallback(flagResult("a", undefined, undefined, "remote"), undefined).reason).toBe("not_found");
    expect(fallbackValue("a", undefined, "not_found", fb)).toBe("control");
    expect(fallbackValue("a", true, "remote", fb)).toBe(true);
  });
});

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

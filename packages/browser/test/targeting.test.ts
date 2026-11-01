import { describe, expect, it } from "vitest";
import { eligible } from "../src/targeting.js";
import type { TargetConditions } from "../src/types.js";

const sv = (conditions: TargetConditions = {}) => ({ conditions });
const ctx = { url: "https://x.test/pricing", flags: () => true, lastShownMs: undefined, nowMs: 1_000_000_000, random: () => 0.5 };

describe("eligible", () => {
  it("matches url modes, flag, wait period and sampling", () => {
    expect(eligible(sv({ url: "/pricing" }), ctx)).toBe(true);
    expect(eligible(sv({ url: "/pricing", url_match: "exact" }), ctx)).toBe(false);
    expect(eligible(sv({ url: "pricing$", url_match: "regex" }), ctx)).toBe(true);
    expect(eligible(sv({ url: "(", url_match: "regex" }), ctx)).toBe(false);
    expect(eligible(sv({ flag_key: "f" }), { ...ctx, flags: () => false })).toBe(false);
    expect(eligible(sv({ wait_days: 1 }), { ...ctx, lastShownMs: ctx.nowMs - 1000 })).toBe(false);
    expect(eligible(sv({ wait_days: 1 }), { ...ctx, lastShownMs: ctx.nowMs - 2 * 86_400_000 })).toBe(true);
    expect(eligible(sv({ sample_pct: 10 }), ctx)).toBe(false);
    expect(eligible(sv({ sample_pct: 90 }), ctx)).toBe(true);
  });
});

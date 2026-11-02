import { describe, expect, it } from "vitest";
import { bucket, heldOut } from "../src/guides/ab.js";
import { scheduleOk } from "../src/targeting.js";
import type { Guide } from "../src/index.js";
import type { TargetConditions } from "../src/types.js";

const guide = (id: string, conditions: TargetConditions): Guide => ({ id, name: id, kind: "modal", steps: [], conditions });

describe("rules the gateway also decides (G55, G241)", () => {
  it("buckets exactly like go/gateway guideBucket (shared vectors)", () => {
    expect(bucket("person-1", "holdout:g") * 2 ** 32).toBe(3210864464);
    expect(bucket("é-☃", "ab:x") * 2 ** 32).toBe(1449930495);
  });

  it("reads recurrence in the guide's timezone when it names one", () => {
    // Sunday 2026-11-01 12:00 UTC is Sunday 07:00 in New York.
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(scheduleOk({ days: [0], hours: { from: 6, to: 9 }, timezone: "America/New_York" }, now)).toBe(true);
    expect(scheduleOk({ days: [0], hours: { from: 12 }, timezone: "America/New_York" }, now)).toBe(false);
    expect(scheduleOk({ days: [1], timezone: "UTC" }, now)).toBe(false);
  });

  it("holds back per variant only when asked", () => {
    let mixed = 0;
    for (let i = 0; i < 200; i++) {
      const k = `person-${i}`;
      const pooled = [guide("a", { holdout_pct: 50, ab_group: "g" }), guide("b", { holdout_pct: 50, ab_group: "g" })];
      expect(heldOut(pooled[0]!, k)).toBe(heldOut(pooled[1]!, k));
      const own = [guide("a", { holdout_pct: 50, ab_group: "g", holdout_scope: "variant" }), guide("b", { holdout_pct: 50, ab_group: "g", holdout_scope: "variant" })];
      if (heldOut(own[0]!, k) !== heldOut(own[1]!, k)) mixed++;
    }
    expect(mixed).toBeGreaterThan(0);
  });
});

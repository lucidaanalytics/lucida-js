import { describe, expect, it } from "vitest";
import { idleGate } from "../src/replay/idle.js";
import { resolveReplay } from "../src/replay/index.js";

const mut = (timestamp: number) => ({ type: 3, timestamp, data: { source: 0 } });
const move = (timestamp: number) => ({ type: 3, timestamp, data: { source: 1 } });

describe("replay idle gate", () => {
  it("drops ticking mutations once idle and asks for a fresh snapshot on the next interaction", () => {
    const g = idleGate(300_000);
    expect(g.check(move(0)).keep).toBe(true);
    expect(g.check(mut(299_000)).keep).toBe(true);
    expect(g.check(mut(301_000)).keep).toBe(false);
    expect(g.check({ type: 2, timestamp: 400_000 }).keep).toBe(false); // checkout snapshots drop too
    expect(g.check(mut(500_000))).toEqual({ keep: false, resumed: false });
    expect(g.check(move(600_000))).toEqual({ keep: true, resumed: true });
    expect(g.check(mut(601_000)).keep).toBe(true);
  });

  it("user activity keeps the page live, and 0 disables the gate", () => {
    const g = idleGate(1000);
    for (let t = 0; t < 10_000; t += 900) expect(g.check(t % 2 ? mut(t) : move(t)).keep).toBe(true);
    const off = idleGate(0);
    expect(off.check(move(0)).keep && off.check(mut(9e9)).keep).toBe(true);
  });

  it("is on at five minutes by default", () => {
    expect(resolveReplay({}, null)?.idle_threshold_ms).toBe(300_000);
    expect(resolveReplay({ idle_threshold_ms: 0 }, null)?.idle_threshold_ms).toBe(0);
  });
});

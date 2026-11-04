import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/index.js";
import { MemStorage } from "./helpers.js";

const NOW = 1_700_000_000_000;
// Hand-built v7 id: uuidv7() is monotonic process-wide, so it cannot produce a past time here.
const v7 = (ms: number) => {
  const h = ms.toString(16).padStart(12, "0");
  return `${h.slice(0, 8)}-${h.slice(8)}-7abc-8def-0123456789ab`;
};
const mk = (t: { n: number }, o = {}) => new SessionManager(new MemStorage(), { clock: { now: () => t.n }, ...o });

describe("session clock and bootstrap guards", () => {
  it("a clock jumping backwards past the idle window rotates", () => {
    const t = { n: NOW };
    const s = mk(t);
    const a = s.touch();
    t.n -= 2 * 3_600_000;
    expect(s.touch().sessionId).not.toBe(a.sessionId);
  });

  it("rejects a bootstrap uuidv7 from the future or older than 24 h, accepts fresh and non-uuid ids", () => {
    for (const [delta, ok] of [[-25 * 3_600_000, false], [0, true], [5 * 60_000, false]] as const) {
      const id = v7(NOW + delta);
      expect(mk({ n: NOW }, { bootstrapId: id }).touch().sessionId === id).toBe(ok);
    }
    expect(mk({ n: NOW }, { bootstrapId: "abc" }).touch().sessionId).toBe("abc");
  });

  it("clamps idle timeout to 1 min .. 10 h", () => {
    const t = { n: NOW };
    const s = mk(t, { idleMs: 5 });
    const a = s.touch();
    t.n += 30_000;
    expect(s.touch().sessionId).toBe(a.sessionId);
    const u = mk(t, { idleMs: 99 * 3_600_000 });
    const b = u.touch();
    t.n += 11 * 3_600_000;
    expect(u.touch().sessionId).not.toBe(b.sessionId);
  });
});

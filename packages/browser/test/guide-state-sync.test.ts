import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guides } from "../src/guides/index.js";
import { mergeGuideState } from "../src/guides/sync.js";
import { resetArbiter } from "../src/arbiter.js";
import type { Client, Guide } from "../src/index.js";
import { startWith } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => {
  resetArbiter();
  localStorage.clear();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/app");
});
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
});

const checklist: Guide = {
  id: "g1",
  name: "Setup",
  kind: "checklist",
  steps: [
    { id: "a", title: "A", body: "" },
    { id: "b", title: "B", body: "" },
  ],
  conditions: {},
};
const stateCalls = (f: ReturnType<typeof startWith>["f"]) => f.calls.filter((c) => c.url.endsWith("/v1/guide-state")).map((c) => JSON.parse(String(c.init!.body)) as Record<string, any>);

describe("mergeGuideState", () => {
  it("unions seen and checklist items, keeps the latest dismissal and the local tour position", () => {
    const merged = mergeGuideState(
      { lc_guide_seen: ["a"], lc_guide_checked: { g1: ["x"] }, lc_guide_dismissed: { g2: 5 }, lc_guide_progress: { t: "s1" }, lc_guide_views: { g1: [3, 1] } },
      { lc_guide_seen: ["b"], lc_guide_checked: { g1: ["y"] }, lc_guide_dismissed: { g2: 9 }, lc_guide_progress: { t: "s2", u: "s9" }, lc_guide_views: { g1: [2] } },
    );
    expect(merged).toMatchObject({
      lc_guide_seen: ["a", "b"],
      lc_guide_checked: { g1: ["x", "y"] },
      lc_guide_dismissed: { g2: 9 },
      lc_guide_progress: { t: "s1", u: "s9" },
      lc_guide_views: { g1: [1, 2, 3] },
    });
  });
});

describe("guide state sync (G55)", () => {
  it("merges the server copy before showing guides and pushes the union back", async () => {
    const r = startWith([guides], {
      persistence: "localStorage",
      _h: {
        "/v1/guides": { guides: [checklist] },
        "/v1/guide-state": { state: { lc_guide_checked: { g1: ["a"] }, lc_guide_seen: ["g1"] } },
      },
    } as never);
    live = r.client;
    live.identify("u1");
    await vi.waitFor(() => expect(stateCalls(r.f).some((b) => b.state)).toBe(true));
    const pulled = stateCalls(r.f).find((b) => !b.state)!;
    expect(pulled).toMatchObject({ api_key: "lc_pk_test", distinct_id: expect.any(String) });
    const pushed = stateCalls(r.f).find((b) => b.state)!;
    expect(pushed.state.lc_guide_checked).toEqual({ g1: ["a"] });
    expect(pushed.state.lc_guide_seen).toEqual(["g1"]);
  });

  it("is skipped when syncState is false and without consent", async () => {
    const off = startWith([guides], { persistence: "localStorage", guides: { syncState: false }, _h: { "/v1/guides": { guides: [] } } } as never);
    live = off.client;
    await vi.waitFor(() => expect(off.f.calls.some((c) => c.url.includes("/v1/guides"))).toBe(true));
    expect(stateCalls(off.f)).toHaveLength(0);
  });
});

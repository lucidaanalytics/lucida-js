import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Lucida, MemoryStickyStore } from "../src/index.js";
import { flag } from "./helpers.js";

const fixtureFile = (body: unknown): string => {
  const f = join(mkdtempSync(join(tmpdir(), "lc-fixture-")), "flags.json");
  writeFileSync(f, JSON.stringify(body));
  return f;
};

describe("testMode", () => {
  it("keeps sticky assignments through a rollout cut when given a store (LC-EXT-29)", async () => {
    const stickyStore = new MemoryStickyStore();
    const on = new Lucida("lc_pk_x", { stickyStore, testMode: { fixture: [flag("s", { sticky: true })] } });
    expect(await on.getFeatureFlag("s", "u1")).toBe(true);
    const cut = new Lucida("lc_pk_x", { stickyStore, testMode: { fixture: [flag("s", { sticky: true, conditions: [{ rollout_pct: 0 }] })] } });
    expect(await cut.getFeatureFlag("s", "u1")).toBe(true);
    expect(await cut.getFeatureFlag("s", "u2")).toBe(false);
    await Promise.all([on.shutdown(), cut.shutdown()]);
  });

  it("evaluates a fixture file offline and never touches the network", async () => {
    const net = vi.spyOn(globalThis, "fetch");
    const pro = flag("pro", { conditions: [{ rollout_pct: 100, filters: [{ type: "person", key: "plan", op: "eq", value: "pro" }] }] });
    const lc = new Lucida("lc_pk_x", { testMode: { fixture: fixtureFile({ flags: [flag("on"), flag("off", { active: false }), pro] }) } });
    await lc.ready;
    expect(await lc.getFeatureFlag("on", "u1")).toBe(true);
    expect(await lc.getFeatureFlag("off", "u1")).toBe(false);
    expect(await lc.isFeatureEnabled("pro", "u1", { personProperties: { plan: "pro" } })).toBe(true);
    expect(await lc.isFeatureEnabled("pro", "u1", { personProperties: { plan: "free" } })).toBe(false);
    expect(await lc.getFeatureFlag("not-in-fixture", "u1")).toBeUndefined();
    expect(await lc.getAllFlags("u1")).toMatchObject({ on: true, off: false });
    await lc.shutdown();
    expect(net).not.toHaveBeenCalled();
    net.mockRestore();
  });

  it("is deterministic and records events in the in-memory sink", async () => {
    const lc = new Lucida("lc_pk_x", { secretKey: "lc_sk_x", testMode: { fixture: [flag("on")] } });
    lc.capture({ distinctId: "u1", event: "signup", properties: { plan: "pro" } });
    lc.identify({ distinctId: "u1", properties: { email: "a@b.c" } });
    await lc.getFeatureFlag("on", "u1");
    await lc.getFeatureFlag("on", "u1"); // exposure dedupes per (user, flag, value)
    expect(lc.captured.map((e) => e.event)).toEqual(["signup", "$identify", "$feature_flag_called", "$exposure"]);
    expect(lc.captured[0]).toMatchObject({ distinct_id: "u1", properties: { plan: "pro" } });
    expect(lc.captured[2]?.properties).toMatchObject({ $feature_flag: "on", $feature_flag_response: true, locally_evaluated: true });
    expect(await lc.importEvents([{ distinctId: "u2", event: "old" }])).toBe(1);
    expect(lc.captured.at(-1)?.event).toBe("old");
  });

  it("rejects a malformed fixture", () => {
    expect(() => new Lucida("lc_pk_x", { testMode: { fixture: fixtureFile({ nope: 1 }) } })).toThrow(/fixture/);
  });
});

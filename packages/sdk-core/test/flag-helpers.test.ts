import { describe, expect, it } from "vitest";
import { MemoryStickyStore, aiConfig, evaluateAll, evaluateAllSticky, migrateRead, migrateWrite, migrationStage } from "../src/index.js";
import type { FlagDefinition, MigrationReport } from "../src/index.js";

const mv = (pct: [number, number]): FlagDefinition => ({
  key: "exp", type: "multivariate", active: true, salt: "s", sticky: true, aggregation: { kind: "person" },
  variants: [{ key: "a", rollout_pct: pct[0] }, { key: "b", rollout_pct: pct[1] }], conditions: [{ rollout_pct: 100 }],
});

describe("sticky store", () => {
  it("keeps the first assignment when weights change", () => {
    const store = new MemoryStickyStore();
    const first = evaluateAllSticky([mv([100, 0])], { distinct_id: "u" }, store).exp;
    expect(first?.value).toBe("a");
    expect(store.get("u")).toEqual({ exp: "a" });
    const later = evaluateAllSticky([mv([0, 100])], { distinct_id: "u" }, store).exp;
    expect(later).toMatchObject({ value: "a", reason: "sticky_bucket" });
    store.clear("exp");
    expect(evaluateAllSticky([mv([0, 100])], { distinct_id: "u" }, store).exp?.value).toBe("b");
  });

  it("cohort hook decides cohort filters", () => {
    const f: FlagDefinition = { key: "c", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" }, conditions: [{ rollout_pct: 100, filters: [{ type: "cohort", key: "k", op: "in" }] }] };
    expect(evaluateAll([f], { distinct_id: "u" }).c?.reason).toBe("requires_server");
    expect(evaluateAll([f], { distinct_id: "u", cohorts: { k: true } }).c?.value).toBe(true);
    expect(evaluateAll([f], { distinct_id: "u", cohorts: { k: false } }).c?.reason).toBe("no_condition_match");
  });
});

describe("migration helper", () => {
  const ops = (log: string[], fail?: string) => ({
    readOld: async () => (log.push("ro"), 1),
    readNew: async () => (log.push("rn"), fail === "rn" ? Promise.reject(new Error("down")) : 2),
    writeOld: async () => (log.push("wo"), fail === "wo" ? Promise.reject(new Error("down")) : "o"),
    writeNew: async () => (log.push("wn"), "n"),
  });

  it("maps flag values to stages", () => {
    expect(migrationStage("shadow")).toBe("shadow");
    expect(migrationStage(false)).toBe("off");
    expect(migrationStage("nope")).toBe("off");
  });

  it("reads and writes per stage", async () => {
    const reports: MigrationReport[] = [];
    let log: string[] = [];
    expect(await migrateRead("off", ops(log))).toBe(1);
    expect(log).toEqual(["ro"]);
    log = [];
    expect(await migrateRead("shadow", { ...ops(log), onReport: (r) => reports.push(r) })).toBe(1);
    expect(log.sort()).toEqual(["rn", "ro"]);
    expect(reports[0]?.consistent).toBe(false);
    expect(await migrateRead("live", ops([]))).toBe(2);
    expect(await migrateRead("complete", ops([]))).toBe(2);
    log = [];
    expect(await migrateWrite("dualwrite", ops(log))).toBe("o");
    expect(log).toEqual(["wo", "wn"]);
    log = [];
    expect(await migrateWrite("rampdown", ops(log))).toBe("n");
    expect(log).toEqual(["wn", "wo"]);
    log = [];
    await expect(migrateWrite("shadow", ops(log, "wo"))).rejects.toThrow("down");
    expect(log).toEqual(["wo"]); // the new side is never written after the authoritative write failed
    expect(await migrateRead("shadow", { ...ops([], "rn"), onReport: (r) => reports.push(r) })).toBe(1);
    expect(reports.at(-1)?.errors.new).toBe("down");
  });
});

describe("ai config", () => {
  it("renders the served variation or the fallback", () => {
    const res = { value: "v2", variant: "v2", reason: "condition_match" as const, condition_index: 0, payload: { model: "m-large", version: 3, messages: [{ role: "system", content: "Hi {{name}} {{missing}}" }], parameters: { temperature: 0.2 } } };
    const c = aiConfig(res, { model: "m-small", messages: [], parameters: {} }, { name: "Ada" });
    expect(c).toEqual({ enabled: true, variation: "v2", version: 3, model: "m-large", messages: [{ role: "system", content: "Hi Ada {{missing}}" }], parameters: { temperature: 0.2 } });
    expect(aiConfig(undefined, { model: "m-small", messages: [], parameters: {} })).toMatchObject({ enabled: false, model: "m-small" });
  });
});

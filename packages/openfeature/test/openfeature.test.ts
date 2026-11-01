import { describe, expect, it } from "vitest";
import { Lucida } from "@lucida/node";
import { LucidaServerProvider, LucidaWebProvider } from "../src/index.js";

const flags = [
  { key: "on", type: "boolean", active: true, salt: "s", conditions: [{ rollout_pct: 100 }], aggregation: { kind: "person" } },
  { key: "cfg", type: "json", active: true, salt: "s", payload: { n: 3 }, conditions: [{ rollout_pct: 100 }], aggregation: { kind: "person" } },
  { key: "num", type: "json", active: true, salt: "s", payload: 7, conditions: [{ rollout_pct: 100 }], aggregation: { kind: "person" } },
  {
    key: "exp", type: "multivariate", active: true, salt: "s", aggregation: { kind: "person" },
    variants: [{ key: "blue", rollout_pct: 100 }], conditions: [{ rollout_pct: 100 }],
  },
] as never;

describe("LucidaServerProvider over the node SDK", () => {
  const p = new LucidaServerProvider(new Lucida("pk", { testMode: { fixture: flags } }));
  it("resolves each type", async () => {
    expect((await p.resolveBooleanEvaluation("on", false, { targetingKey: "u1" })).value).toBe(true);
    expect(await p.resolveStringEvaluation("exp", "x", { targetingKey: "u1" })).toMatchObject({ value: "blue", variant: "blue" });
    expect((await p.resolveObjectEvaluation("cfg", {}, { targetingKey: "u1" })).value).toEqual({ n: 3 });
    expect((await p.resolveNumberEvaluation("num", 0, { targetingKey: "u1" })).value).toBe(7);
  });
  it("reports errors with the default", async () => {
    expect(await p.resolveBooleanEvaluation("nope", true, { targetingKey: "u1" })).toMatchObject({ value: true, errorCode: "FLAG_NOT_FOUND" });
    expect(await p.resolveBooleanEvaluation("on", false, {})).toMatchObject({ errorCode: "TARGETING_KEY_MISSING" });
    expect(await p.resolveStringEvaluation("on", "d", { targetingKey: "u1" })).toMatchObject({ value: "d", errorCode: "TYPE_MISMATCH" });
  });
});

describe("LucidaWebProvider", () => {
  it("identifies, reloads, then reads synchronously", async () => {
    const calls: string[] = [];
    const p = new LucidaWebProvider({
      identify: (id) => calls.push(`identify ${id}`),
      reset: () => undefined,
      getFlag: (k) => (k === "on" ? true : undefined),
      getFlagPayload: () => undefined,
      reloadFlags: async () => void calls.push("reload"),
    });
    await p.initialize({ targetingKey: "u9" });
    expect(calls).toEqual(["identify u9", "reload"]);
    expect(p.resolveBooleanEvaluation("on", false).value).toBe(true);
    expect(p.resolveBooleanEvaluation("off", false).errorCode).toBe("FLAG_NOT_FOUND");
  });
});

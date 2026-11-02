import type { WireEvent } from "@lucida/sdk-core";
import { afterEach, describe, expect, it } from "vitest";
import type { DevtoolsTarget } from "../src/index.js";
import { startWith, tick } from "./helpers.js";

const g = globalThis as Record<string, unknown>;
afterEach(() => delete g.__LUCIDA_DEVTOOLS_HOOK__);

describe("devtools hook (P-M36)", () => {
  it("does nothing without a hook", () => {
    const { client } = startWith([]);
    expect(() => client.capture("x")).not.toThrow();
  });

  it("attaches and mirrors captured events to an extension hook", async () => {
    const seen: WireEvent[] = [];
    let target: DevtoolsTarget | undefined;
    g.__LUCIDA_DEVTOOLS_HOOK__ = { attach: (t: DevtoolsTarget) => (target = t), emit: (e: WireEvent) => seen.push(e) };
    const { client } = startWith([]);
    client.capture("checkout", { plan: "pro" });
    await tick(10);
    expect(seen.map((e) => e.event)).toContain("checkout");
    expect(target?.projectKeyPrefix).toBe("lc_pk_te");
    expect(target?.distinctId()).toBe(client.distinctId);
    expect(await target?.startReplay()).toBe(false); // no replay module loaded
  });

  it("a throwing hook never breaks capture", () => {
    g.__LUCIDA_DEVTOOLS_HOOK__ = {
      attach: () => undefined,
      emit: () => {
        throw new Error("boom");
      },
    };
    const { client } = startWith([]);
    expect(() => client.capture("x")).not.toThrow();
  });
});

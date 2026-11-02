import { describe, expect, it, vi } from "vitest";
import type { FlagDefinition } from "@lucida-analytics/sdk-core";
import { start } from "./helpers.js";

const base = { capturePageview: false, autocapture: false } as const;
const signup = { type: "event", key: "signup", op: "is_set", scope: "session" } as const;

describe("runtime-event targeting (P-H6)", () => {
  it("resolves gateway branches when the event is captured and notifies once", async () => {
    const { client } = start({
      ...base,
      _h: {
        "/v1/flags": {
          flags: {
            promo: {
              enabled: false, value: false, reason: "no_condition_match", condition_index: -1,
              runtime: [{ filters: [signup], result: { enabled: true, value: "b", variant: "b", payload: { x: 2 }, reason: "condition_match", condition_index: 0 } }],
            },
          },
        },
      },
    } as never);
    const seen: Array<Record<string, unknown>> = [];
    client.onFlags((f) => seen.push({ ...f }));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(client.getFlag("promo")).toBe(false);
    client.capture("browse");
    expect(seen).toHaveLength(1); // nothing changed, nobody notified
    client.capture("signup");
    await vi.waitFor(() => expect(client.getFlag("promo")).toBe("b"));
    expect(client.getFlagPayload("promo")).toEqual({ x: 2 });
    client.capture("signup");
    expect(seen.filter((f) => f.promo === "b")).toHaveLength(1);
  });

  it("local evaluation counts page views separately from the session", async () => {
    const def: FlagDefinition = {
      key: "deep", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" },
      conditions: [{ rollout_pct: 100, filters: [{ type: "event", key: "view_item", op: "gte", value: 2, scope: "page" }] }],
    };
    const { client } = start({ ...base, flagOptions: { disableRemote: true }, localFlags: [def] } as never);
    expect(client.getFlag("deep")).toBe(false);
    client.capture("view_item");
    client.capture("view_item");
    await vi.waitFor(() => expect(client.getFlag("deep")).toBe(true));
    client.capture("$pageview");
    await vi.waitFor(() => expect(client.getFlag("deep")).toBe(false)); // a new page starts at zero
  });

  it("re-resolves a dependent flag when its runtime-branched prerequisite flips", async () => {
    const on = { enabled: true, value: true, reason: "condition_match", condition_index: 0 };
    const { client } = start({
      ...base,
      _h: {
        "/v1/flags": {
          flags: {
            base: { enabled: false, value: false, reason: "no_condition_match", condition_index: -1, runtime: [{ filters: [signup], result: on }] },
            child: {
              enabled: false, value: false, reason: "prerequisite_failed", condition_index: -1,
              runtime: [{ filters: [{ type: "flag", key: "base", op: "eq", value: true }], result: on }],
            },
          },
        },
      },
    } as never);
    await vi.waitFor(() => expect(client.getFlag("child")).toBe(false));
    client.capture("signup");
    await vi.waitFor(() => expect(client.getFlag("base")).toBe(true));
    expect(client.getFlag("child")).toBe(true);
  });

  it("counts only events whose properties match an event filter's predicates", async () => {
    const def: FlagDefinition = {
      key: "big_spender", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" },
      conditions: [{
        rollout_pct: 100,
        filters: [{ type: "event", key: "purchase", op: "gte", value: 2, properties: [{ type: "event_property", key: "amount", op: "gt", value: 100 }] }],
      }],
    };
    const { client } = start({ ...base, flagOptions: { disableRemote: true }, localFlags: [def] } as never);
    client.capture("purchase", { amount: 500 });
    client.capture("purchase", { amount: 5 });
    expect(client.getFlag("big_spender")).toBe(false);
    client.capture("purchase", { amount: 101 });
    await vi.waitFor(() => expect(client.getFlag("big_spender")).toBe(true));
  });
});

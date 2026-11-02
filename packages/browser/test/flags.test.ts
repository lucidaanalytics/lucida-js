import { describe, expect, it, vi } from "vitest";
import type { FlagDefinition } from "@lucida-analytics/sdk-core";
import { start, startWith } from "./helpers.js";
import { flags } from "../src/flags/index.js";

const base = { capturePageview: false, autocapture: false } as const;

describe("flags module", () => {
  it("fetches POST /v1/flags, notifies onFlags, emits $feature_flag_called once per value", async () => {
    const { client, t, f } = start({
      ...base,
      _h: { "/v1/flags": { flags: { a: { enabled: true, value: true, reason: "condition_match" }, v: { enabled: true, variant: "B", value: "B", payload: { x: 1 } } }, request_id: "r1" } },
    } as never);
    const seen: Array<Record<string, unknown>> = [];
    client.onFlags((fl) => seen.push(fl));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(f.calls[0]!.url).toBe("https://ingest.test/v1/flags");
    const body = JSON.parse(f.calls[0]!.init!.body as string);
    expect(body).toMatchObject({ api_key: "lc_pk_test", distinct_id: client.distinctId });
    expect(seen).toEqual([{ a: true, v: "B" }]);
    expect(client.isFeatureEnabled("a")).toBe(true);
    expect(client.isFeatureEnabled("missing")).toBe(false);
    expect(client.getFlag("v")).toBe("B");
    expect(client.getFlag("v")).toBe("B");
    expect(client.getFlagPayload("v")).toEqual({ x: 1 });
    await client.flush();
    const exposures = t.events().filter((e) => e.event === "$exposure");
    expect(exposures.map((e) => e.properties.$feature_flag)).toEqual(["a", "v"]);
    expect(exposures[1]!.properties.$feature_flag_variant).toBe("B");
    const called = t.events().filter((e) => e.event === "$feature_flag_called");
    expect(called.map((e) => e.properties.$feature_flag)).toEqual(["a", "v"]);
    expect(called[0]!.properties.$feature_flag_request_id).toBe("r1");
  });

  it("bootstrap flags are available synchronously", () => {
    const { client } = start({ ...base, bootstrap: { distinctId: "boot", flags: { x: "on" } } });
    expect(client.distinctId).toBe("boot");
    expect(client.getFlag("x")).toBe("on");
  });

  it("reloads on identify", async () => {
    const { client, f } = start({ ...base, _h: { "/v1/flags": { flags: {} } } } as never);
    const flagCalls = () => f.calls.filter((c) => c.url.endsWith("/v1/flags"));
    await vi.waitFor(() => expect(flagCalls()).toHaveLength(1));
    client.identify("user-9");
    await vi.waitFor(() => expect(flagCalls()).toHaveLength(2));
    const bodies = flagCalls().map((c) => JSON.parse(c.init!.body as string));
    expect(bodies.map((b) => b.distinct_id)).toEqual([bodies[0].distinct_id, "user-9"]);
    // LC-FLG-34: only the post-identify request carries the pre-identify id.
    expect(bodies[0]).not.toHaveProperty("anon_distinct_id");
    expect(bodies[1].anon_distinct_id).toBe(bodies[0].distinct_id);
  });

  it("fetches remote config once when autocapture is unset", async () => {
    const { f } = start({ capturePageview: false, _h: { "/v1/config": { autocapture: false } } } as never);
    await vi.waitFor(() => expect(f.calls.filter((c) => c.url.includes("/v1/config?api_key=lc_pk_test"))).toHaveLength(1));
  });
});

describe("flag contexts (LC-FLG-18)", () => {
  const bodies = (f: ReturnType<typeof start>["f"]) => f.calls.filter((c) => c.url.endsWith("/v1/flags")).map((c) => JSON.parse(c.init!.body as string) as Record<string, any>);

  it("sends device_id and every set context, and refetches on change", async () => {
    const { client, f } = start({ ...base, _h: { "/v1/flags": { flags: {} } } } as never);
    await vi.waitFor(() => expect(bodies(f)).toHaveLength(1));
    expect(bodies(f)[0]!.device_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(bodies(f)[0]).not.toHaveProperty("contexts");
    client.setContext("org", "acme", { plan: "enterprise" });
    client.setContext("user", "u1");
    await vi.waitFor(() => expect(bodies(f)).toHaveLength(3));
    expect(bodies(f).at(-1)!.contexts).toEqual({ org: { key: "acme", properties: { plan: "enterprise" } }, user: { key: "u1", properties: {} } });
    expect(bodies(f).at(-1)!.device_id).toBe(bodies(f)[0]!.device_id);
    client.clearContext("user");
    await vi.waitFor(() => expect(bodies(f)).toHaveLength(4));
    expect(Object.keys(bodies(f).at(-1)!.contexts)).toEqual(["org"]);
  });

  it("forgets contexts on reset but keeps the device id", async () => {
    const { client, f } = start({ ...base, _h: { "/v1/flags": { flags: {} } } } as never);
    client.setContext("org", "acme");
    await vi.waitFor(() => expect(bodies(f).some((b) => b.contexts)).toBe(true));
    const device = bodies(f)[0]!.device_id;
    const before = bodies(f).length;
    client.reset();
    await vi.waitFor(() => expect(bodies(f).length).toBeGreaterThan(before));
    expect(bodies(f).at(-1)).not.toHaveProperty("contexts");
    expect(bodies(f).at(-1)!.device_id).toBe(device);
  });

  it("sends nothing, and stores nothing, until analytics consent is granted", async () => {
    const lsSet = vi.spyOn(Storage.prototype, "setItem");
    const { client, f } = start({ ...base, persistence: "localStorage", consent: { mode: "opt_in" }, _h: { "/v1/flags": { flags: {} } } } as never);
    client.setContext("user", "u1", { email: "a@b.test" });
    await new Promise((r) => setTimeout(r, 10)); // negative check: nothing may happen, so there is nothing to wait for
    expect(f.calls).toHaveLength(0);
    expect(lsSet).not.toHaveBeenCalled();
    client.optIn();
    await vi.waitFor(() => expect(bodies(f)).toHaveLength(1));
    expect(bodies(f)[0]!.contexts.user.properties).toEqual({ email: "a@b.test" });
    expect(JSON.stringify([...lsSet.mock.calls])).not.toContain("a@b.test"); // contexts are never persisted
    lsSet.mockRestore();
  });

  it("evaluates context filters locally", async () => {
    const def: FlagDefinition = { key: "ent", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" }, conditions: [{ rollout_pct: 100, filters: [{ type: "context", context_kind: "org", key: "plan", op: "eq", value: "enterprise" }] }] };
    const { client } = startWith([flags], { localFlags: [def] });
    expect(client.getFlag("ent")).toBe(false);
    client.setContext("org", "acme", { plan: "enterprise" });
    await vi.waitFor(() => expect(client.getFlag("ent")).toBe(true));
    client.clearContext("org");
    await vi.waitFor(() => expect(client.getFlag("ent")).toBe(false));
  });
});

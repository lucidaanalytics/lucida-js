import { describe, expect, it, vi } from "vitest";
import type { FlagDefinition } from "@lucida-analytics/sdk-core";
import { start } from "./helpers.js";

const base = { capturePageview: false, autocapture: false } as const;
const ok = { flags: { a: { enabled: true, value: true }, v: { enabled: true, value: "B", variant: "B" } } };
const flagBodies = (f: ReturnType<typeof start>["f"]) =>
  f.calls.filter((c) => c.url.endsWith("/v1/flags")).map((c) => JSON.parse(c.init!.body as string) as Record<string, any>);

describe("flag values on events", () => {
  it("attaches $feature/<key> and $active_feature_flags without overwriting caller props", async () => {
    const { client, t } = start({ ...base, _h: { "/v1/flags": ok } } as never);
    await vi.waitFor(() => expect(client.getAllFlags()).toEqual({ a: true, v: "B" }));
    client.capture("clicked", { "$feature/a": "mine" });
    await client.flush();
    const e = t.events().find((x) => x.event === "clicked")!;
    expect(e.properties["$feature/a"]).toBe("mine");
    expect(e.properties["$feature/v"]).toBe("B");
    expect(e.properties.$active_feature_flags).toEqual(["a", "v"]);
  });

  it("sendFeatureFlags: false leaves events alone, and getAllFlags records no exposure", async () => {
    const { client, t } = start({ ...base, sendFeatureFlags: false, _h: { "/v1/flags": ok } } as never);
    await vi.waitFor(() => expect(client.getAllFlags()).toHaveProperty("a"));
    client.capture("clicked");
    await client.flush();
    expect(t.events().find((x) => x.event === "clicked")!.properties).not.toHaveProperty("$active_feature_flags");
    expect(t.events().some((x) => x.event === "$exposure")).toBe(false);
  });
});

describe("flag cost controls and overrides", () => {
  it("disableRemote never requests; bootstrap payloads and updateFlags supply values", async () => {
    const { client, f } = start({ ...base, flagOptions: { disableRemote: true }, bootstrap: { flags: { x: "on" }, payloads: { x: { n: 1 } } }, _h: { "/v1/flags": ok } } as never);
    expect(client.getFlagPayload("x")).toEqual({ n: 1 });
    client.updateFlags({ y: true }, { y: "p" });
    expect(client.getAllFlags()).toEqual({ x: "on", y: true });
    expect(client.getFlagPayload("y")).toBe("p");
    await client.reloadFlags();
    expect(flagBodies(f)).toHaveLength(0);
  });

  it("disableFlagsOnFirstLoad waits for reloadFlags; flagsApiHost and app contexts are used", async () => {
    const { client, f } = start({ ...base, disableFlagsOnFirstLoad: true, flagsApiHost: "https://flags.test", flagOptions: { evaluationContexts: ["web"] }, _h: { "/v1/flags": ok } } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(flagBodies(f)).toHaveLength(0);
    await client.reloadFlags();
    expect(f.calls.at(-1)!.url).toBe("https://flags.test/v1/flags");
    expect(flagBodies(f)[0]!.app_contexts).toEqual(["web"]);
    expect(flagBodies(f)[0]!.device_properties.$device_type).toMatch(/Mobile|Tablet|Desktop/);
    expect(flagBodies(f)[0]!.person_properties.$initial_referrer).toBeDefined();
  });

  it("overrideFlags wins over server values and false clears it", async () => {
    const { client } = start({ ...base, _h: { "/v1/flags": ok } } as never);
    await vi.waitFor(() => expect(client.getFlag("a")).toBe(true));
    client.overrideFlags({ a: false, z: "forced" });
    expect(client.getFlag("a")).toBe(false);
    expect(client.getFlag("z")).toBe("forced");
    client.overrideFlags(false);
    expect(client.getFlag("a")).toBe(true);
    expect(client.getFlag("z")).toBeUndefined();
  });

  it("person and group properties for flags are additive, sent, and reset", async () => {
    const { client, f } = start({ ...base, _h: { "/v1/flags": ok } } as never);
    await vi.waitFor(() => expect(flagBodies(f)).toHaveLength(1));
    client.setPersonPropertiesForFlags({ plan: "pro" });
    client.setPersonPropertiesForFlags({ seats: 3 });
    client.setGroupPropertiesForFlags({ company: { tier: "gold" } });
    await vi.waitFor(() => expect(flagBodies(f)).toHaveLength(2)); // same-tick triggers coalesce into one request
    await new Promise((r) => setTimeout(r, 20));
    expect(flagBodies(f)).toHaveLength(2);
    const last = flagBodies(f).at(-1)!;
    expect(last.person_properties).toMatchObject({ plan: "pro", seats: 3 });
    expect(last.group_properties).toEqual({ company: { tier: "gold" } });
    client.resetPersonPropertiesForFlags();
    client.resetGroupPropertiesForFlags();
    await client.reloadFlags();
    expect(flagBodies(f).at(-1)!.person_properties).not.toHaveProperty("plan");
    expect(flagBodies(f).at(-1)).not.toHaveProperty("group_properties");
  });

  it("keeps cached values when the gateway reports quota_limited", async () => {
    const { client } = start({ ...base, bootstrap: { flags: { a: "kept" } }, _h: { "/v1/flags": { flags: {}, quota_limited: true } } } as never);
    await client.reloadFlags();
    expect(client.getAllFlags()).toEqual({ a: "kept" });
  });

  it("reset() keeps the device id and reset(true) rotates it", async () => {
    const { client, f } = start({ ...base, _h: { "/v1/flags": { flags: {} } } } as never);
    await vi.waitFor(() => expect(flagBodies(f)).toHaveLength(1));
    const device = flagBodies(f)[0]!.device_id;
    client.reset();
    await vi.waitFor(() => expect(flagBodies(f)).toHaveLength(2));
    expect(flagBodies(f)[1]!.device_id).toBe(device);
    client.reset(true);
    await vi.waitFor(() => expect(flagBodies(f)).toHaveLength(3));
    expect(flagBodies(f)[2]!.device_id).not.toBe(device);
  });

  it("local evaluation drops flags limited to other app contexts", () => {
    const def = (key: string, app_contexts?: string[]): FlagDefinition => ({
      key, type: "boolean", active: true, salt: "s", aggregation: { kind: "person" }, conditions: [{ rollout_pct: 100 }], ...(app_contexts ? { app_contexts } : {}),
    });
    const { client } = start({ ...base, flagOptions: { disableRemote: true, evaluationContexts: ["web"] }, localFlags: [def("all"), def("docs", ["docs"])] } as never);
    expect(client.getAllFlags()).toEqual({ all: true });
  });
});

describe("flag client coalescing and partial responses", () => {
  it("errors_while_computing_flags keeps values the response omitted", async () => {
    const { client } = start({ ...base, bootstrap: { flags: { a: "kept", b: "old" } }, _h: { "/v1/flags": { flags: { b: "new" }, errors_while_computing_flags: true } } } as never);
    await client.reloadFlags();
    expect(client.getAllFlags()).toEqual({ a: "kept", b: "new" });
  });

  it("onFlags fires with cached values and $feature_flag_called repeats after reset", async () => {
    const { client, t } = start({ ...base, bootstrap: { flags: { a: true } }, _h: { "/v1/flags": ok } } as never);
    const seen: Array<Record<string, unknown>> = [];
    client.onFlags((fl) => seen.push(fl));
    expect(seen[0]).toEqual({ a: true });
    client.getFlag("a");
    client.getFlag("a");
    client.reset();
    expect(client.getAllFlags()).toEqual({}); // the previous person's values are gone until the refetch lands
    await vi.waitFor(() => expect(client.getAllFlags()).toHaveProperty("a"));
    client.getFlag("a");
    await client.flush();
    expect(t.events().filter((e) => e.event === "$feature_flag_called")).toHaveLength(2);
  });
});

describe("flag client edge cases walked from posthog-js", () => {
  it("a payload-only bootstrap entry is an enabled flag and cached flags survive the bootstrap", () => {
    const { client } = start({ ...base, flagOptions: { disableRemote: true }, bootstrap: { flags: { a: "x" }, payloads: { p: { n: 1 } } } } as never);
    expect(client.getAllFlags()).toEqual({ a: "x", p: true });
    expect(client.getFlagPayload("p")).toEqual({ n: 1 });
  });

  it("$feature_flag_called carries reason, bootstrap use and fetch errors", async () => {
    const { client, t } = start({ ...base, bootstrap: { flags: { a: true } }, _h: { "/v1/flags": { flags: { b: true }, errors_while_computing_flags: true } } } as never);
    client.getFlag("a");
    await client.reloadFlags();
    client.getFlag("b");
    await client.flush();
    const calls = t.events().filter((e) => e.event === "$feature_flag_called");
    expect(calls[0]!.properties).toMatchObject({ $feature_flag: "a", $used_bootstrap_value: true, $feature_flag_reason: "bootstrap" });
    expect(calls[0]!.properties).not.toHaveProperty("$feature_flag_error");
    expect(calls[1]!.properties).toMatchObject({ $feature_flag: "b", $feature_flag_error: "errors_while_computing_flags" });
    expect(calls[1]!.properties).not.toHaveProperty("$used_bootstrap_value");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => history.replaceState({}, "", "/start"));
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
});

const base = { capturePageview: false, autocapture: false } as const;
const body = {
  flags: {
    on: { enabled: true, value: true, reason: "condition_match" },
    v: { enabled: true, value: "B", variant: "B", payload: { n: 1 } },
  },
};
const flagBodies = (f: ReturnType<typeof start>["f"]) =>
  f.calls.filter((c) => c.url.endsWith("/v1/flags")).map((c) => JSON.parse(c.init!.body as string) as Record<string, any>);

describe("getFlagResult", () => {
  it("returns value, variant, payload and the server reason; sendExposure false records nothing", async () => {
    const { client, t } = start({ ...base, _h: { "/v1/flags": body } } as never);
    live = client;
    await vi.waitFor(() => expect(client.getFlag("v")).toBe("B"));
    expect(client.getFlagResult("on", { sendExposure: false })).toEqual({ key: "on", value: true, enabled: true, reason: "condition_match" });
    expect(client.getFlagResult("v", { sendExposure: false })).toEqual({ key: "v", value: "B", enabled: true, variant: "B", payload: { n: 1 }, reason: "remote" });
    expect(client.getFlagResult("nope", { sendExposure: false })).toEqual({ key: "nope", value: undefined, enabled: false, reason: "not_found" });
    await client.flush();
    expect(t.events().filter((e) => e.event === "$exposure" && e.properties.$feature_flag === "on")).toHaveLength(0);
    client.getFlagResult("on"); // default: a read like getFlag
    await client.flush();
    expect(t.events().some((e) => e.event === "$exposure" && e.properties.$feature_flag === "on")).toBe(true);
  });

  it("reports bootstrap, pushed and override sources", async () => {
    const { client } = start({ ...base, flagOptions: { disableRemote: true }, bootstrap: { flags: { b: true } } } as never);
    live = client;
    expect(client.getFlagResult("b", { sendExposure: false }).reason).toBe("bootstrap");
    client.updateFlags({ p: "x" });
    expect(client.getFlagResult("p", { sendExposure: false }).reason).toBe("pushed");
    client.overrideFlags({ b: false });
    expect(client.getFlagResult("b")).toMatchObject({ value: false, enabled: false, reason: "override" });
  });
});

describe("flag request cache TTL", () => {
  it("skips automatic refreshes inside the TTL, but reloadFlags and property changes still fetch", async () => {
    const { client, f } = start({ ...base, flagOptions: { cacheTtlMs: 60_000, refreshMs: 15 }, _h: { "/v1/flags": body } } as never);
    live = client;
    await vi.waitFor(() => expect(flagBodies(f)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 120)); // several refresh ticks, all inside the TTL
    expect(flagBodies(f)).toHaveLength(1);
    await client.reloadFlags();
    expect(flagBodies(f)).toHaveLength(2);
    client.setPersonPropertiesForFlags({ plan: "pro" }, false);
    await new Promise((r) => setTimeout(r, 60)); // the change cleared the stamp, so the next refresh tick fetches
    expect(flagBodies(f).length).toBeGreaterThanOrEqual(3);
  });

  it("without a TTL every refresh fetches", async () => {
    const { client, f } = start({ ...base, flagOptions: { refreshMs: 15 }, _h: { "/v1/flags": body } } as never);
    live = client;
    await vi.waitFor(() => expect(flagBodies(f).length).toBeGreaterThanOrEqual(3));
  });
});

describe("automatic flag properties", () => {
  it("sends campaign, $os, $browser and $device_type as person properties; autoProperties:false opts out", async () => {
    history.replaceState({}, "", "/lp?utm_source=news&gclid=G1");
    const on = start({ ...base, _h: { "/v1/flags": body } } as never);
    live = on.client;
    await vi.waitFor(() => expect(flagBodies(on.f)).toHaveLength(1));
    expect(flagBodies(on.f)[0]!.person_properties).toMatchObject({ $utm_source: "news", $gclid: "G1" });
    expect(flagBodies(on.f)[0]!.person_properties.$os).toBeTypeOf("string");
    expect(flagBodies(on.f)[0]!.person_properties.$browser).toBeTypeOf("string");
    expect(flagBodies(on.f)[0]!.person_properties.$device_type).toMatch(/Mobile|Tablet|Desktop/);

    const off = start({ ...base, flagOptions: { autoProperties: false }, _h: { "/v1/flags": body } } as never);
    await vi.waitFor(() => expect(flagBodies(off.f)).toHaveLength(1));
    const pp = flagBodies(off.f)[0]!.person_properties;
    expect(pp).not.toHaveProperty("$utm_source");
    expect(pp).not.toHaveProperty("$os");
    expect(pp).not.toHaveProperty("$device_type");
    await off.client.shutdown();
  });

  it("explicit person properties win over the automatic ones", async () => {
    const { client, f } = start({ ...base, _h: { "/v1/flags": body } } as never);
    live = client;
    await vi.waitFor(() => expect(flagBodies(f)).toHaveLength(1));
    client.setPersonPropertiesForFlags({ $os: "Custom" });
    await vi.waitFor(() => expect(flagBodies(f).at(-1)!.person_properties.$os).toBe("Custom"));
  });
});

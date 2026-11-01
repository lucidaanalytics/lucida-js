import { describe, expect, it, vi } from "vitest";
import { createClient } from "../src/index.js";
import type { NativeConfig } from "../src/index.js";

interface Sent { event: string; properties: Record<string, unknown> }

function setup(over: NativeConfig = {}, flagsBody: unknown = { flags: { a: { enabled: true, value: true } } }) {
  const sent: Sent[] = [];
  const reqs: Array<{ url: string; body: Record<string, any> }> = [];
  const cfg: NativeConfig = {
    apiHost: "https://ingest.test",
    flushAt: 1,
    appVersion: "2.1.0",
    platform: "ios",
    transport: {
      send: async (_u, body) => {
        sent.push(...(JSON.parse(body) as { batch: Sent[] }).batch);
        return { status: 200 };
      },
    },
    fetch: (async (url: string, init?: RequestInit) => {
      reqs.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return { ok: true, status: 200, json: async () => flagsBody };
    }) as unknown as typeof fetch,
    ...over,
  };
  return { cfg, sent, reqs };
}

describe("react-native flag depth", () => {
  it("attaches flag values to events and sends default props and app contexts", async () => {
    const { cfg, sent, reqs } = setup({ flagOptions: { evaluationContexts: ["mobile"] } });
    const c = await createClient("lc_pk_x", cfg);
    await vi.waitFor(() => expect(c.getAllFlags()).toEqual({ a: true }));
    expect(reqs[0]!.url).toBe("https://ingest.test/v1/flags");
    expect(reqs[0]!.body).toMatchObject({ app_contexts: ["mobile"], app_version: "2.1.0", person_properties: { $app_version: "2.1.0", $os: "ios", $lib: "lucida-react-native" } });
    c.capture("tap");
    await vi.waitFor(() => expect(sent.find((e) => e.event === "tap")?.properties.$active_feature_flags).toEqual(["a"]));
    await c.shutdown();
  });

  it("preload false waits; disableRemoteFeatureFlags never fetches; bootstrap, update and override work", async () => {
    const lazy = setup({ flagOptions: { preload: false } });
    const c1 = await createClient("lc_pk_x", lazy.cfg);
    expect(lazy.reqs).toHaveLength(0);
    await c1.reloadFlags();
    expect(lazy.reqs).toHaveLength(1);
    await c1.shutdown();

    const off = setup({ disableRemoteFeatureFlags: true, sendDefaultFlagProps: false, flagOptions: { bootstrap: { flags: { x: "B" }, payloads: { x: 1 } } } });
    const c2 = await createClient("lc_pk_x", off.cfg);
    await c2.reloadFlags();
    expect(off.reqs).toHaveLength(0);
    expect(c2.getFlagPayload("x")).toBe(1);
    c2.updateFlags({ y: true }, {}, { merge: true });
    c2.overrideFlags({ x: "forced" });
    expect(c2.getAllFlags()).toEqual({ x: "forced", y: true });
    c2.overrideFlags(false);
    expect(c2.getFlag("x")).toBe("B");
    await c2.shutdown();
  });

  it("person properties for flags are sent and reset; quota_limited keeps values", async () => {
    const { cfg, reqs } = setup({ sendDefaultFlagProps: false, flagOptions: { bootstrap: { flags: { kept: true } } } }, { flags: {}, quota_limited: true });
    const c = await createClient("lc_pk_x", cfg);
    c.setPersonPropertiesForFlags({ plan: "pro" });
    await vi.waitFor(() => expect(reqs.at(-1)!.body.person_properties).toEqual({ plan: "pro" }));
    expect(c.getAllFlags()).toEqual({ kept: true });
    c.resetPersonPropertiesForFlags();
    await c.reloadFlags();
    expect(reqs.at(-1)!.body.person_properties).toEqual({});
    await c.shutdown();
  });
});

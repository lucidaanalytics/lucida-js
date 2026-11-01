import { afterEach, describe, expect, it, vi } from "vitest";
import { earlyAccess } from "../src/early-access/index.js";
import { flags } from "../src/flags/index.js";
import type { Client } from "../src/index.js";
import { startWith, tick } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
});

const features = [
  { flag_key: "new-editor", name: "New editor", stage: "beta" },
  { flag_key: "ai-search", name: "AI search", stage: "alpha" },
];

describe("client.earlyAccess", () => {
  it("lists features and reflects this browser's opt-ins", async () => {
    const { client } = startWith([earlyAccess], { _h: { "/v1/early-access": { features } } } as never);
    live = client;
    expect((await client.earlyAccess.list()).map((f) => f.enrolled)).toEqual([false, false]);
    client.earlyAccess.optIn("ai-search");
    expect((await client.earlyAccess.list()).map((f) => f.enrolled)).toEqual([false, true]);
    client.earlyAccess.optOut("ai-search");
    expect((await client.earlyAccess.list()).every((f) => f.enrolled === false)).toBe(true);
  });

  it("emits $early_access_opt_in with the enrolment person property", async () => {
    const { client, t, f } = startWith([earlyAccess], { _h: { "/v1/early-access": { features } } } as never);
    live = client;
    client.earlyAccess.optIn("new-editor");
    client.earlyAccess.optOut("new-editor");
    await client.flush();
    const evs = t.events().filter((e) => e.event === "$early_access_opt_in") as Array<{
      properties: Record<string, unknown>;
      $set?: Record<string, unknown>;
    }>;
    expect(evs.map((e) => e.properties.$enrolled)).toEqual([true, false]);
    expect(evs[0]!.properties.$feature_flag).toBe("new-editor");
    expect(evs[0]!.$set).toMatchObject({ "$feature_enrollment/new-editor": true });
    expect(f.calls.some((c) => c.url.includes("api_key=lc_pk_test"))).toBe(false); // nothing fetched by opt-in alone
  });

  it("sends the enrolment person property with flag requests so the release condition matches", async () => {
    const { client, f } = startWith([flags, earlyAccess], { _h: { "/v1/flags": { flags: { "new-editor": true } } } } as never);
    live = client;
    client.earlyAccess.optIn("new-editor");
    await vi.waitFor(() => expect(client.getFlag("new-editor")).toBe(true));
    const bodies = f.calls.filter((c) => c.url.endsWith("/v1/flags")).map((c) => JSON.parse(String(c.init?.body)) as { person_properties: Record<string, unknown> });
    expect(bodies.at(-1)!.person_properties).toMatchObject({ "$feature_enrollment/new-editor": true });
  });

  it("is a harmless no-op without the module", async () => {
    const { client } = startWith([], {});
    live = client;
    expect(await client.earlyAccess.list()).toEqual([]);
    await tick();
    expect(() => client.earlyAccess.optIn("x")).not.toThrow();
  });
});

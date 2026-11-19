import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import { atlasIdentity } from "../src/atlas/index.js";
import type { Client } from "../src/index.js";
import { fakeTransport, startWith } from "./helpers.js";
import { until } from "./replay-helpers.js";

const g = globalThis as Record<string, unknown>;
let live: Client[] = [];
afterEach(async () => {
  await Promise.all(live.map((c) => c.shutdown()));
  live = [];
  delete g.watchtower;
  delete g.lucida;
  delete (window as unknown as Record<string, unknown>).Atlas;
  delete (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl;
  vi.useRealTimers();
});

const session = (userId: string | null) => window.dispatchEvent(new CustomEvent("atlas:session", { detail: { signedIn: userId !== null, userId } }));
const sent = async (c: Client, t: ReturnType<typeof fakeTransport>) => (await c.flush(), t.events());

describe("atlasIdentity", () => {
  it("identifies on sign-in with the property, resets on sign-out, ignores sign-out it did not cause", async () => {
    const { client, t } = startWith([atlasIdentity({ property: "atlas_sub" })], { capturePageview: false });
    live.push(client);
    session(null);
    expect(client.getDistinctId()).not.toBe("usr_1");
    session("usr_1");
    expect(client.getDistinctId()).toBe("usr_1");
    const ev = await sent(client, t);
    expect(JSON.stringify(ev)).toContain("atlas_sub");
    session(null);
    expect(client.getDistinctId()).not.toBe("usr_1");
  });

  it("picks up an existing session and one that appears after init (polling)", async () => {
    vi.useFakeTimers();
    const { client } = startWith([atlasIdentity()], { capturePageview: false });
    live.push(client);
    (window as unknown as Record<string, unknown>).Atlas = { session: { user: { id: "usr_late" } } };
    await vi.advanceTimersByTimeAsync(300);
    expect(client.getDistinctId()).toBe("usr_late");
  });

  it("does nothing for a signed-out initial state", () => {
    (window as unknown as Record<string, unknown>).Atlas = { session: { user: null } };
    const { client } = startWith([atlasIdentity()], { capturePageview: false });
    live.push(client);
    const before = client.getDistinctId();
    session(null);
    expect(client.getDistinctId()).toBe(before);
  });
});

describe("exposeGlobal follows Watchtower", () => {
  it("turns on when globalThis.watchtower is present at init", () => {
    g.watchtower = {};
    live.push(startWith([], {}).client);
    expect(g.lucida).toBeDefined();
  });
  it("turns on when watchtower:ready fires later", () => {
    live.push(startWith([], {}).client);
    expect(g.lucida).toBeUndefined();
    window.dispatchEvent(new Event("watchtower:ready"));
    expect(g.lucida).toBeDefined();
  });
  it("respects an explicit false and stays off without Watchtower", () => {
    g.watchtower = {};
    live.push(startWith([], { exposeGlobal: false }).client);
    window.dispatchEvent(new Event("watchtower:ready"));
    expect(g.lucida).toBeUndefined();
  });
});

describe("remote respect_gpc", () => {
  const boot = (remote: Record<string, unknown>, extra: object = {}) => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    const t = fakeTransport();
    const f = (async () => new Response(JSON.stringify(remote), { status: 200 })) as unknown as typeof fetch;
    const c = createClient("lc_pk_test", { persistence: "memory", transport: t, offlineQueue: false, apiHost: "https://ingest.test", fetch: f, ...extra });
    live.push(c);
    return { c, t };
  };
  it("GPC + remote respect_gpc opts out", async () => {
    const { c, t } = boot({ respect_gpc: true });
    c.capture("a");
    await until(() => !c.getConsent().analytics);
    expect((await sent(c, t)).map((e) => e.event)).not.toContain("a");
  });
  it("without the remote flag GPC is ignored", async () => {
    const { c, t } = boot({ respect_gpc: false });
    c.capture("a");
    await until(() => true);
    await new Promise((r) => setTimeout(r, 30));
    expect((await sent(c, t)).map((e) => e.event)).toContain("a");
  });
  it("an explicit respectGpc:false wins over the remote flag", async () => {
    const { c, t } = boot({ respect_gpc: true }, { respectGpc: false });
    c.capture("a");
    await new Promise((r) => setTimeout(r, 30));
    expect((await sent(c, t)).map((e) => e.event)).toContain("a");
  });
});

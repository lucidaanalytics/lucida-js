import { describe, expect, it } from "vitest";
import { createClient, LIB } from "../src/index.js";
import { fakeApp, fakePreferences, setup, tick } from "./support.js";

describe("capacitor client: consent", () => {
  it("opt_in: no capture and no Preferences write before consent", async () => {
    const { prefs, writes, data } = fakePreferences();
    const { cfg, sent, fetchUrls } = setup({ preferences: prefs, consent: { mode: "opt_in" } });
    const c = await createClient("k", cfg);
    c.capture("before");
    c.identify("u1");
    c.register({ plan: "pro" });
    c.getFlag("x");
    await c.flush();
    await tick();
    expect(sent).toEqual([]);
    expect(writes).toEqual([]);
    expect(fetchUrls).toEqual([]); // no flag request before consent
    expect(c.isOptedOut()).toBe(true);

    c.optIn();
    c.capture("after");
    await c.flush();
    await tick();
    expect(sent.map((e) => e.event)).toEqual(["$opt_in", "after"]);
    expect(data.get("lucida.lc_consent")).toContain('"analytics":true');
    expect(data.has("lucida.lc_identity")).toBe(true);
    expect(fetchUrls).toContain("https://ingest.test/v1/flags");
  });

  it("opt_out (default) captures right away", async () => {
    const { cfg, sent } = setup();
    const c = await createClient("k", cfg);
    c.capture("e");
    await c.flush();
    expect(sent.map((e) => e.event)).toEqual(["$app_opened", "e"]);
  });

  it("optOut stops capture", async () => {
    const { cfg, sent } = setup();
    const c = await createClient("k", cfg);
    c.optOut();
    c.capture("ignored");
    await c.flush();
    await tick();
    expect(sent.map((e) => e.event)).not.toContain("ignored");
    expect(c.isOptedOut()).toBe(true);
  });
});

describe("capacitor client: lifecycle", () => {
  it("captures $app_opened at start, $app_backgrounded with a flush, $app_opened on return", async () => {
    const app = fakeApp();
    const { cfg, sent } = setup({ app, flushAt: 100 });
    const c = await createClient("k", cfg);
    expect(sent).toEqual([]); // queued, not yet flushed
    app.emit(false);
    await tick();
    expect(sent.map((e) => [e.event, e.properties.from_background])).toEqual([
      ["$app_opened", false],
      ["$app_backgrounded", undefined],
    ]);
    app.emit(false); // repeated state: counted once
    app.emit(true);
    await c.flush();
    expect(sent.map((e) => e.event)).toEqual(["$app_opened", "$app_backgrounded", "$app_opened"]);
    expect(sent[2]?.properties.from_background).toBe(true);
    await c.shutdown();
    await tick();
    expect(app.listeners).toBe(0);
  });

  it("reads the App plugin and platform from the Capacitor bridge", async () => {
    const app = fakeApp();
    const g = globalThis as { Capacitor?: unknown };
    g.Capacitor = { getPlatform: () => "android", Plugins: { App: app } };
    try {
      const { cfg, sent } = setup();
      delete cfg.platform;
      await createClient("k", cfg);
      expect(app.listeners).toBe(1);
      await tick();
      expect(sent[0]?.properties.$os).toBe("android");
    } finally {
      delete g.Capacitor;
    }
  });
});

describe("capacitor client: wire format and flush", () => {
  it("posts {api_key, batch, sent_at} to /v1/batch with a uuid and $lib per event, without $lc_* props", async () => {
    const { cfg, sent, bodies } = setup({ flushAt: 10, appVersion: "1.2.3" });
    const c = await createClient("key_1", cfg);
    c.capture("purchase", { amount: 3, $lc_project_id: "evil" });
    c.screen("Home", { $lc_org: "x" });
    await c.flush();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.url).toBe("https://ingest.test/v1/batch");
    expect(bodies[0]?.body.api_key).toBe("key_1");
    expect(typeof bodies[0]?.body.sent_at).toBe("string");
    const [opened, purchase, screen] = sent;
    expect(new Set(sent.map((e) => e.uuid)).size).toBe(3);
    expect(purchase?.properties).toMatchObject({ amount: 3, $lib: LIB, $os: "ios", $app_version: "1.2.3" });
    expect(purchase?.properties).not.toHaveProperty("$lc_project_id");
    expect(screen?.properties).toMatchObject({ $screen_name: "Home" });
    expect(screen?.properties).not.toHaveProperty("$lc_org");
    expect(opened?.distinct_id).toBe(c.distinctId);
  });

  it("identify links the anonymous id and flags attach to events", async () => {
    const { cfg, sent } = setup({}, { flags: { beta: { enabled: true }, color: { variant: "red", payload: { a: 1 } } } });
    const c = await createClient("k", cfg);
    await c.reloadFlags();
    const anon = c.distinctId;
    c.identify("user-1");
    await c.flush();
    const ident = sent.find((e) => e.event === "$identify");
    expect(ident?.distinct_id).toBe("user-1");
    expect(ident?.properties.$anon_distinct_id).toBe(anon);
    expect(c.isFeatureEnabled("beta")).toBe(true);
    expect(c.getFlag("color")).toBe("red");
    expect(c.getFlagPayload("color")).toEqual({ a: 1 });
    await c.flush();
    expect(ident?.properties["$feature/beta"]).toBe(true);
    expect(sent.filter((e) => e.event === "$feature_flag_called")).toHaveLength(2);
  });

  it("parks undeliverable batches in Preferences and drains them later", async () => {
    const { prefs, data } = fakePreferences();
    let online = false;
    const delivered: string[] = [];
    const fetchImpl = (async (url: string, init?: { body?: string }) => {
      if (url.endsWith("/v1/flags")) return { ok: true, status: 200, json: async () => ({ flags: {} }) };
      if (!online) throw new Error("offline");
      delivered.push(init?.body ?? "");
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    const c = await createClient("k", { apiHost: "https://ingest.test", flushAt: 1, preferences: prefs, fetch: fetchImpl });
    c.capture("offline_event");
    await c.flush();
    await tick();
    expect(data.get("lucida.lc_offline")).toContain("offline_event");
    online = true;
    c.optIn(); // a consent change drains the parked batches
    await tick();
    expect(delivered.join()).toContain("offline_event");
  });
});

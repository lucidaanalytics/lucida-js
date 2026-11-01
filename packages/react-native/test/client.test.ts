import { describe, expect, it } from "vitest";
import { appLifecycle, createClient, screenTracker } from "../src/index.js";
import type { AppStateLike, AppStateStatus, AsyncStorageLike, NativeConfig } from "../src/index.js";

interface Sent { event: string; properties: Record<string, unknown> }

function fakeAsyncStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const as: AsyncStorageLike = {
    multiGet: async (keys) => keys.map((k) => [k, data.get(k) ?? null] as const),
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
  return { as, data };
}

function fakeAppState(): AppStateLike & { emit(s: AppStateStatus): void } {
  const fns: Array<(s: AppStateStatus) => void> = [];
  return {
    currentState: "active",
    addEventListener: (_t, fn) => (fns.push(fn), { remove: () => void fns.splice(fns.indexOf(fn), 1) }),
    emit: (s) => fns.forEach((f) => f(s)),
  };
}

function setup(over: NativeConfig = {}, flagsBody: unknown = { flags: {} }) {
  const sent: Sent[] = [];
  const urls: string[] = [];
  const cfg: NativeConfig = {
    apiHost: "https://ingest.test",
    flushAt: 1,
    transport: {
      send: async (_u, body) => {
        sent.push(...(JSON.parse(body) as { batch: Sent[] }).batch);
        return { status: 200 };
      },
    },
    fetch: (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => flagsBody };
    }) as unknown as typeof fetch,
    ...over,
  };
  return { cfg, sent, urls };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("react-native client", () => {
  it("hydrates identity from async storage and captures $app_opened", async () => {
    const { as, data } = fakeAsyncStorage({
      lc_identity: JSON.stringify({ distinct_id: "stored", anon_id: "stored", identified: false }),
    });
    const { cfg, sent } = setup({ asyncStorage: as });
    const c = await createClient("k", cfg);
    expect(c.distinctId).toBe("stored");
    await c.flush();
    expect(sent.map((e) => e.event)).toContain("$app_opened");
    expect(data.has("lc_session")).toBe(true);
  });

  it("writes nothing to storage before consent in opt_in mode", async () => {
    const { as, data } = fakeAsyncStorage();
    const { cfg, sent } = setup({ asyncStorage: as, consent: { mode: "opt_in" } });
    const c = await createClient("k", cfg);
    c.capture("x");
    c.identify("u1");
    await tick();
    expect(data.size).toBe(0);
    expect(sent).toEqual([]);
    c.optIn();
    await tick();
    expect(data.has("lc_identity")).toBe(true);
  });

  it("emits install, then update on a new version", async () => {
    const { as } = fakeAsyncStorage();
    const a = setup({ asyncStorage: as, appVersion: "1.0.0" });
    await (await createClient("k", a.cfg)).flush();
    expect(a.sent.map((e) => e.event)).toContain("$app_installed");
    const b = setup({ asyncStorage: as, appVersion: "1.1.0" });
    await (await createClient("k", b.cfg)).flush();
    const up = b.sent.find((e) => e.event === "$app_updated");
    expect(up?.properties.$previous_app_version).toBe("1.0.0");
  });

  it("maps AppState transitions to $app_backgrounded / $app_opened", async () => {
    const app = fakeAppState();
    const { cfg, sent } = setup({ appState: app });
    await createClient("k", cfg);
    app.emit("background");
    app.emit("active");
    await tick();
    const names = sent.map((e) => e.event);
    expect(names).toContain("$app_backgrounded");
    expect(names.filter((n) => n === "$app_opened").length).toBe(2);
  });

  it("appLifecycle ignores repeated states", () => {
    const app = fakeAppState();
    const calls: string[] = [];
    const stop = appLifecycle(app, { onForeground: () => calls.push("fg"), onBackground: () => calls.push("bg") });
    app.emit("active");
    app.emit("inactive");
    app.emit("background");
    app.emit("active");
    stop();
    app.emit("background");
    expect(calls).toEqual(["bg", "fg"]);
  });

  it("evaluates local flags and falls back to server flags", async () => {
    const { cfg, sent } = setup(
      {
        localFlags: [{ key: "on", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" }, conditions: [{ rollout_pct: 100 }] },
          { key: "coh", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" }, conditions: [{ filters: [{ type: "cohort", key: "c1", op: "in" }], rollout_pct: 100 }] },
        ],
      },
      { flags: { remote: { enabled: true, value: true, payload: { a: 1 } } }, request_id: "r" },
    );
    const c = await createClient("k", cfg);
    expect(c.getFlag("on")).toBe(true);
    expect(c.isFeatureEnabled("nope")).toBe(false);
    await c.reloadFlags();
    await tick();
    expect(c.getFlag("remote")).toBe(true);
    expect(c.getFlagPayload("remote")).toEqual({ a: 1 });
    await c.flush();
    expect(sent.filter((e) => e.event === "$feature_flag_called").length).toBe(2);
  });

  it("tracks screens and dedupes by route in screenTracker", async () => {
    const { cfg, sent } = setup();
    const c = await createClient("k", cfg);
    let route = "Home";
    const t = screenTracker(c, { current: { getCurrentRoute: () => ({ name: route, params: { id: 1 } }) } });
    t.onReady();
    t.onStateChange();
    route = "Detail";
    t.onStateChange();
    await c.flush();
    const screens = sent.filter((e) => e.event === "$screen").map((e) => e.properties.$screen_name);
    expect(screens).toEqual(["Home", "Detail"]);
    expect(sent.find((e) => e.event === "$screen")?.properties.$screen_params).toBeUndefined();
  });
});

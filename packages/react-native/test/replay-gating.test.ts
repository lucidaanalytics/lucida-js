import { describe, expect, it } from "vitest";
import { createClient, effectiveMinDurationMs, effectiveSampleRate, encryptedStorage, screenAllowed, withTimeout } from "../src/index.js";
import type { NativeConfig, NativeReplayModule, ReplayConfig } from "../src/index.js";

interface Sent {
  seq: number;
  events: Array<{ type: number; data: Record<string, unknown> }>;
}

const capture = (text = "****") =>
  JSON.stringify({
    width: 390,
    height: 844,
    events: [
      { type: 4, timestamp: 1, data: { href: "app://X", width: 390, height: 844 } },
      { type: 2, timestamp: 1, data: { node: { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: "html", childNodes: [{ type: 2, id: 3, tagName: "body", childNodes: [{ type: 3, id: 4, textContent: text }] }] }] } } },
    ],
  });

async function setup(replay: Partial<ReplayConfig> = {}, remote: Record<string, unknown> = {}, over: Partial<NativeConfig> = {}) {
  const posts: Sent[] = [];
  const urls: string[] = [];
  const module = { out: capture(), async captureWireframe() { return module.out; } };
  let tick: () => void = () => {};
  const cfg: NativeConfig = {
    apiHost: "https://ingest.test",
    consent: { mode: "opt_out" },
    transport: { send: async () => ({ status: 200 }) },
    fetch: (async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.endsWith("/v1/replay")) {
        posts.push(JSON.parse(String(init?.body)) as Sent);
        return { ok: true, status: 200 };
      }
      if (url.includes("/v1/config")) return { ok: true, status: 200, json: async () => remote };
      return { ok: true, status: 200, json: async () => ({ flags: {} }) };
    }) as unknown as typeof fetch,
    replay: { enabled: true, module: module as NativeReplayModule, setInterval: (fn) => ((tick = fn), 1), clearInterval: () => {}, ...replay },
    ...over,
  };
  const client = await createClient("lc_pk_x", cfg);
  const run = async () => {
    tick();
    await new Promise((r) => setTimeout(r, 5));
  };
  return { client, module, posts, urls, run };
}

describe("replay policy helpers", () => {
  it("screen lists: deny wins, empty allow means all", () => {
    expect(screenAllowed("A")).toBe(true);
    expect(screenAllowed("A", ["B"])).toBe(false);
    expect(screenAllowed("A", ["A"], ["A"])).toBe(false);
    expect(screenAllowed("A", [], ["B"])).toBe(true);
  });

  it("remote config can only tighten", () => {
    const r = { replay_sample_rate: 0.5, replay_min_duration_ms: 3000 };
    expect(effectiveSampleRate(1, r)).toBe(0.5);
    expect(effectiveSampleRate(0.1, r)).toBe(0.1);
    expect(effectiveSampleRate(1, { session_recording: false })).toBe(0);
    expect(effectiveSampleRate(1, null)).toBe(1);
    expect(effectiveMinDurationMs(5000, r)).toBe(5000);
    expect(effectiveMinDurationMs(0, r)).toBe(3000);
  });
});

describe("react-native replay gating", () => {
  it("remote kill switch stops recording; useRemoteConfig false ignores it", async () => {
    const t = await setup({}, { session_recording: false });
    await t.run();
    expect(t.posts).toHaveLength(0);
    expect(t.urls).toContain("https://ingest.test/v1/config?api_key=lc_pk_x");
    const u = await setup({ useRemoteConfig: false }, { session_recording: false });
    await u.run();
    expect(u.posts).toHaveLength(1);
  });

  it("min duration holds chunks, flushes them in order, drops them on stop", async () => {
    let clock = 1_000_000;
    // the service captures Date.now at creation, so stub it before setup()
    const realNow = Date.now;
    Date.now = () => clock;
    try {
      const t = await setup({ minDurationMs: 10_000 });
      await t.run();
      t.module.out = capture("changed");
      clock += 4000;
      await t.run();
      expect(t.posts).toHaveLength(0);
      t.module.out = capture("again");
      clock += 7000;
      await t.run();
      expect(t.posts.map((p) => p.seq)).toEqual([0, 1, 2]);

      const u = await setup({ minDurationMs: 10_000 });
      await u.run();
      u.client.replay.stop();
      u.client.replay.start();
      u.module.out = capture("x");
      clock += 60_000;
      await u.run();
      expect(u.posts).toHaveLength(1); // only the fresh snapshot after the stop; the held chunk was dropped
      expect(u.posts[0]?.seq).toBe(0);
    } finally {
      Date.now = realNow;
    }
  });

  it("remote min duration applies", async () => {
    const t = await setup({}, { session_recording: true, replay_min_duration_ms: 5000 });
    await t.run();
    expect(t.posts).toHaveLength(0);
  });

  it("linked flag gates recording", async () => {
    const t = await setup({ linkedFlag: "replay-on" }, {}, { flagOptions: { bootstrap: { flags: { "replay-on": false } } } });
    await t.run();
    expect(t.posts).toHaveLength(0);
    expect(t.client.replay.isRecording()).toBe(false);
    const u = await setup({ linkedFlag: "replay-on" }, {}, { flagOptions: { bootstrap: { flags: { "replay-on": true } } }, disableRemoteFeatureFlags: true });
    await u.run();
    expect(u.posts).toHaveLength(1);
    expect(u.client.replay.isRecording()).toBe(true);
  });

  it("denied screen pauses recording and re-entering sends a fresh snapshot; not-allowed screens are skipped", async () => {
    const t = await setup({ screenAllowList: ["Home", "Checkout"], screenDenyList: ["Checkout"] });
    t.client.screen("Home");
    await t.run();
    t.client.screen("Checkout");
    await t.run();
    expect(t.posts).toHaveLength(1);
    expect(t.client.replay.isRecording()).toBe(false);
    t.client.screen("Home");
    await t.run();
    expect(t.posts).toHaveLength(2);
    t.client.screen("Other");
    await t.run();
    expect(t.posts).toHaveLength(2);
  });

  it("captureTouches: a tap rides the next chunk against the body node; off drops it", async () => {
    for (const on of [true, false]) {
      const t = await setup({ captureTouches: on });
      t.client.replay.tap(1, 1); // before any snapshot: dropped
      await t.run();
      t.client.replay.tap(15, 25);
      t.module.out = capture("changed");
      await t.run();
      const last = t.posts.at(-1)!;
      expect(last.events.map((e) => e.type)).toEqual(on ? [3, 4, 2] : [4, 2]);
      if (on) expect(last.events[0]?.data).toEqual({ source: 2, type: 2, id: 3, x: 15, y: 25 });
    }
  });
});

describe("tap targets from the native view tree", () => {
  const view = (id: number, x: number, y: number, w: number, h: number, kids: unknown[] = []) => ({
    type: 2,
    id,
    tagName: "div",
    attributes: { style: `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:hidden` },
    childNodes: kids,
  });
  const tree = {
    type: 0,
    id: 1,
    childNodes: [
      { type: 2, id: 2, tagName: "html", childNodes: [{ type: 2, id: 3, tagName: "body", attributes: { style: "position:relative;width:390px;height:844px" }, childNodes: [view(10, 20, 100, 200, 300, [view(11, 10, 10, 50, 50), view(12, 10, 70, 50, 50)]), view(20, 0, 0, 390, 60)] }] }],
    ],
  };
  it("lands on the deepest, topmost view containing the point (offsets accumulate), else the body", async () => {
    const { hitTest } = await import("../src/replay-hit.js");
    expect(hitTest(tree, 40, 120, 3)).toBe(11); // inside 10 > 11 (20+10, 100+10)
    expect(hitTest(tree, 40, 180, 3)).toBe(12);
    expect(hitTest(tree, 200, 250, 3)).toBe(10); // inside 10 but on no child
    expect(hitTest(tree, 5, 5, 3)).toBe(20);
    expect(hitTest(tree, 380, 800, 3)).toBe(3); // sized body, no view there
    expect(hitTest(undefined, 1, 1, 7)).toBe(7);
  });
});

describe("transport options for custom transports and cipher", () => {
  it("maxBatchSize splits and requestTimeoutMs bounds a custom transport", async () => {
    const sent: number[] = [];
    const slow = await createClient("lc_pk_x", {
      apiHost: "https://ingest.test",
      consent: { mode: "opt_out" },
      maxBatchSize: 2,
      flushAt: 1000,
      transport: { send: async (_u, body) => (sent.push((JSON.parse(body) as { batch: unknown[] }).batch.length), { status: 200 }) },
    });
    for (let i = 0; i < 5; i++) slow.capture(`e${i}`);
    await slow.flush();
    expect(sent.every((n) => n <= 2)).toBe(true);
    expect(sent.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5);

    const hung = withTimeout({ send: () => new Promise(() => {}) }, 10);
    expect(await hung.send("u", "b")).toEqual({ status: 0 });
    const ok = withTimeout({ send: async () => ({ status: 204 }) }, 50);
    expect(await ok.send("u", "b")).toEqual({ status: 204 });
  });

  it("encryptedStorage encrypts only the listed keys and a wrong key reads as empty", () => {
    const mem = new Map<string, string>();
    const base = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v), remove: (k: string) => void mem.delete(k) };
    const cipher = { encrypt: (s: string) => `enc:${[...s].reverse().join("")}`, decrypt: (c: string) => (c.startsWith("enc:") ? [...c.slice(4)].reverse().join("") : null) };
    const s = encryptedStorage(base, cipher, ["lc_offline"]);
    s.set("lc_offline", "queue");
    s.set("lc_session", "plain");
    expect(mem.get("lc_offline")).toBe("enc:eueuq");
    expect(mem.get("lc_session")).toBe("plain");
    expect(s.get("lc_offline")).toBe("queue");
    mem.set("lc_offline", "garbage");
    expect(s.get("lc_offline")).toBeNull();
  });
});

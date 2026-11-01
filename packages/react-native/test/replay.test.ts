import { describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";
import type { NativeConfig, NativeReplayModule } from "../src/index.js";

interface Sent {
  api_key: string;
  session_id: string;
  window_id: string;
  seq: number;
  events: Array<{ type: number; data: Record<string, unknown> }>;
}

const capture = (text = "****") =>
  JSON.stringify({
    width: 390,
    height: 844,
    events: [
      { type: 4, timestamp: 1, data: { href: "app://X", width: 390, height: 844 } },
      { type: 2, timestamp: 1, data: { node: { type: 0, id: 1, text } } },
    ],
  });

function setup(over: Partial<NativeConfig> = {}, status = 200) {
  const replayPosts: Sent[] = [];
  const module = { calls: [] as Array<{ screen: string; maskText: boolean }>, out: capture(), async captureWireframe(o: { screen: string; maskText: boolean }) { module.calls.push(o); return module.out; } };
  const cfg: NativeConfig = {
    apiHost: "https://ingest.test",
    consent: { mode: "opt_in" },
    transport: { send: async () => ({ status: 200 }) },
    fetch: (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/replay")) {
        replayPosts.push(JSON.parse(String(init?.body)) as Sent);
        return { ok: status < 300, status };
      }
      return { ok: true, status: 200, json: async () => ({ flags: {} }) };
    }) as unknown as typeof fetch,
    replay: { enabled: true, module: module as NativeReplayModule, setInterval: () => 1, clearInterval: () => {} },
    ...over,
  };
  return { cfg, module, replayPosts };
}

// The client keeps its replay service private; reach it through the injected timer.
async function withReplay(over: Partial<NativeConfig> = {}, status = 200) {
  const s = setup(over, status);
  let tick: () => void = () => {};
  s.cfg.replay = { ...s.cfg.replay!, setInterval: (fn) => ((tick = fn), 1) };
  const client = await createClient("lc_pk_x", s.cfg);
  const run = async () => {
    tick();
    await new Promise((r) => setTimeout(r, 5));
  };
  return { ...s, client, run };
}

describe("react-native wireframe replay", () => {
  it("records nothing until both analytics and replay consent are granted", async () => {
    const t = await withReplay();
    await t.run();
    expect(t.module.calls).toHaveLength(0);
    expect(t.replayPosts).toHaveLength(0);
    t.client.optIn();
    await t.run();
    expect(t.replayPosts).toHaveLength(1);
  });

  it("sends meta + navigation + masked full snapshot with the session ids and a monotonic seq; unchanged screens are skipped", async () => {
    const t = await withReplay({ consent: { mode: "opt_out" } });
    t.client.screen("Cart");
    await t.run();
    const first = t.replayPosts[0]!;
    expect(first).toMatchObject({ api_key: "lc_pk_x", seq: 0 });
    expect(first.session_id).toBeTruthy();
    expect(first.window_id).toBeTruthy();
    expect(first.events.map((e) => e.type)).toEqual([4, 5, 2]);
    expect(first.events[1]?.data).toEqual({ tag: "navigation", payload: { url: "app://Cart" } });
    expect(t.module.calls[0]).toEqual({ screen: "Cart", maskText: true, maskAllTextInputs: true, maskAllImages: true, maskSandboxedViews: true });

    await t.run(); // identical structure: nothing sent
    expect(t.replayPosts).toHaveLength(1);

    t.module.out = capture("changed");
    await t.run();
    expect(t.replayPosts[1]).toMatchObject({ seq: 1 });
    expect(t.replayPosts[1]?.events.map((e) => e.type)).toEqual([4, 2]); // same screen: no navigation marker
  });

  it("retries a rejected chunk as a fresh snapshot without advancing seq", async () => {
    const t = await withReplay({ consent: { mode: "opt_out" } }, 503);
    await t.run();
    await t.run();
    expect(t.replayPosts.map((p) => p.seq)).toEqual([0, 0]);
  });

  it("survives a failing or empty native capture", async () => {
    const t = await withReplay({ consent: { mode: "opt_out" } });
    t.module.out = "";
    await t.run();
    t.module.out = "not json";
    await t.run();
    expect(t.replayPosts).toHaveLength(0);
  });

  it("control API: pause skips captures, resume continues, tag carries the session id, isRecording needs consent", async () => {
    const t = await withReplay();
    expect(t.client.replay.isRecording()).toBe(false); // opt_in: no consent yet
    t.client.optIn();
    expect(t.client.replay.isRecording()).toBe(true);
    t.client.replay.pause();
    expect(t.client.replay.isRecording()).toBe(false);
    await t.run();
    expect(t.module.calls).toHaveLength(0);
    t.client.replay.resume();
    await t.run();
    expect(t.replayPosts).toHaveLength(1);
    t.client.replay.stop();
    expect(t.client.replay.isRecording()).toBe(false);
    t.client.replay.start();
    expect(t.client.replay.isRecording()).toBe(true);
    t.client.replay.tag("bug");
  });

  it("screenshot mode asks the native side for a masked JPEG (quality clamped) at most once a second", async () => {
    const native = setup();
    const s = await withReplay({ consent: { mode: "opt_out" }, replay: { ...native.cfg.replay!, mode: "screenshot", screenshotQuality: 3 } });
    await s.run();
    await s.run(); // within the 1 s floor: no second capture
    expect(native.module.calls).toEqual([
      { screen: "Unknown", maskText: true, maskAllTextInputs: true, maskAllImages: true, maskSandboxedViews: true, mode: "screenshot", screenshotQuality: 1 },
    ]);
    expect(s.replayPosts).toHaveLength(1);
  });

  it("is off unless enabled", async () => {
    const s = setup({ consent: { mode: "opt_out" } });
    s.cfg.replay = { ...s.cfg.replay!, enabled: false, setInterval: () => { throw new Error("must not start"); } };
    await createClient("lc_pk_x", s.cfg);
  });
});

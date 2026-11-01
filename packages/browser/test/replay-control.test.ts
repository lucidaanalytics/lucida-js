import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { replay } from "../src/replay/index.js";
import type { BrowserConfig, Client } from "../src/index.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until, wait } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

function boot(cfg: BrowserConfig = {}, remote: unknown = {}) {
  document.body.innerHTML = "<p>page-copy</p>";
  const t = fakeTransport();
  const f = replayFetch(remote);
  live = createClient(
    "lc_pk_test",
    { persistence: "memory", apiHost: "https://ingest.test", transport: t, fetch: f.fn, capturePageview: false, ...cfg },
    [replay],
  );
  return { f, t, client: live };
}

describe("replay control API (LC-EXP-27)", () => {
  it("is a safe no-op without the replay module", async () => {
    const c = createClient("k", { persistence: "memory", disabled: true });
    live = c;
    c.replay.stop();
    c.replay.pause();
    c.replay.tag("x");
    await c.replay.start();
    expect(c.replay.isRecording()).toBe(false);
  });

  it("stop, start, pause, resume drive the recorder", async () => {
    const { client } = boot({ replay: { flush_interval_ms: 40 } });
    await until(() => client.replay.isRecording());
    client.replay.pause();
    expect(client.replay.isRecording()).toBe(false);
    client.replay.resume();
    expect(client.replay.isRecording()).toBe(true);
    client.replay.stop();
    expect(client.replay.isRecording()).toBe(false);
    await client.replay.start();
    expect(client.replay.isRecording()).toBe(true);
  });

  it("nothing is sent while paused", async () => {
    const { f, client } = boot({ replay: { flush_interval_ms: 30 } });
    await until(() => client.replay.isRecording());
    client.replay.pause();
    await wait(100);
    const n = f.posts.length;
    document.body.append(Object.assign(document.createElement("p"), { textContent: "PAUSED-ONLY-TEXT" }));
    await wait(150);
    expect(f.posts.slice(n).map((p) => p.raw).join("")).not.toContain("PAUSED-ONLY-TEXT");
  });

  it("manual start bypasses sampling; auto-start does not", async () => {
    const a = boot({ replay: { sample_rate: 0 } });
    await wait(100);
    expect(a.client.replay.isRecording()).toBe(false);
    await a.client.replay.start();
    expect(a.client.replay.isRecording()).toBe(true);
  });

  it("manual start never bypasses consent", async () => {
    const { f, client } = boot({ consent: { mode: "opt_in" } });
    await client.replay.start();
    expect(client.replay.isRecording()).toBe(false);
    expect(f.urls).toEqual([]);
    client.setConsent({ analytics: true, replay: true });
    await until(() => client.replay.isRecording());
  });

  it("manual start never bypasses the project never-record pages", async () => {
    const { client } = boot({}, { replay_never_record: ["*"] });
    await client.replay.start();
    expect(client.replay.isRecording()).toBe(false);
  });

  it("a manual stop survives a consent re-grant", async () => {
    const { client } = boot();
    await until(() => client.replay.isRecording());
    client.replay.stop();
    client.setConsent({ replay: true });
    await wait(80);
    expect(client.replay.isRecording()).toBe(false);
  });

  it("tag emits $replay_tag with the session id", async () => {
    const { t, client } = boot();
    client.replay.tag("checkout-bug");
    await client.flush();
    const e = t.events().find((x) => x.event === "$replay_tag");
    expect(e?.properties).toMatchObject({ name: "checkout-bug", session_id: expect.any(String) });
    expect(e?.properties.session_id).toBe(e?.properties.$session_id);
  });
});

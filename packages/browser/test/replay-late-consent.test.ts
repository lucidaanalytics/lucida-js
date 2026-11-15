import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { replay } from "../src/replay/index.js";
import { cookieMunchBridge } from "../src/consent/index.js";
import type { Client } from "../src/index.js";
import type { Module } from "../src/types.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until, wait } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  delete (window as { CookieMunch?: unknown }).CookieMunch;
  await live?.shutdown();
  live = undefined;
});

function boot(remote: unknown = {}, modules: Module[] = [replay], consent: "opt_in" | "opt_out" = "opt_in") {
  document.body.innerHTML = "<p>page-copy</p>";
  const t = fakeTransport();
  const f = replayFetch(remote);
  live = createClient(
    "lc_pk_test",
    { persistence: "memory", apiHost: "https://ingest.test", transport: t, fetch: f.fn, capturePageview: false, consent: { mode: consent }, replay: { flush_interval_ms: 40 } },
    modules,
  );
  return { t, client: live };
}

describe("replay starts on the current page when consent is granted mid-page", () => {
  it("setConsent grant starts the recorder without a reload", async () => {
    const { client } = boot();
    await wait(100);
    expect(client.replay.isRecording()).toBe(false);
    client.setConsent({ analytics: true, replay: true });
    await until(() => client.replay.isRecording());
    expect(client.replay.isRecording()).toBe(true);
  });

  it("a Cookie Munch grant starts the recorder without a reload", async () => {
    const { client } = boot({}, [replay, cookieMunchBridge()]);
    await wait(100);
    expect(client.replay.isRecording()).toBe(false);
    (window as { CookieMunch?: unknown }).CookieMunch = { hasResponse: true, consent: { statistics: true } };
    window.dispatchEvent(new Event("CookieMunchOnChange"));
    await until(() => client.replay.isRecording());
    expect(client.replay.isRecording()).toBe(true);
  });
});

describe("$recording_status on excluded URLs", () => {
  const status = async (remote: unknown): Promise<unknown> => {
    const { t, client } = boot(remote, [replay], "opt_out");
    const last = (): unknown => [...t.events()].reverse().find((e) => e.event === "probe")?.properties?.$recording_status;
    await until(() => {
      client.capture("probe");
      const s = last();
      return s !== undefined && s !== "awaiting_config" && s !== "lazy_loading";
    }, 4000);
    return last();
  };

  it("reads excluded, not sampled, when sampling misses on an excluded URL", async () => {
    expect(await status({ replay_sample_rate: 0, replay_url_blocklist: ["*"] })).toBe("excluded");
  });

  it("still reads sampled on an allowed URL", async () => {
    expect(await status({ replay_sample_rate: 0 })).toBe("sampled");
  });
});

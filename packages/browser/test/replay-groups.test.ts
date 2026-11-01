import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { fnv1a32, replay, resolveReplay, sampled } from "../src/replay/index.js";
import type { BrowserConfig, Client } from "../src/index.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until } from "./replay-helpers.js";

// jsdom: import.meta.url is not a file URL; vitest runs from the package directory
const vectors = JSON.parse(readFileSync(resolve(process.env.LUCIDA_TESTDATA ?? resolve(process.cwd(), "../../testdata"), "replay/sampling.json"), "utf8")) as {
  cases: Array<{ session_id: string; key: string; rate: number; hash: number; sampled: boolean }>;
};

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

function boot(cfg: BrowserConfig = {}, remote: unknown = {}) {
  document.body.innerHTML = `<p>visible-copy</p><input id="q" type="text" value="SECRET-QUERY">`;
  const f = replayFetch(remote);
  const t = fakeTransport();
  live = createClient(
    "lc_pk_test",
    { persistence: "memory", apiHost: "https://ingest.test", transport: t, fetch: f.fn, capturePageview: false, flushAt: 1, ...cfg },
    [replay],
  );
  const last = (name: string) => [...t.events()].reverse().find((e) => e.event === name)?.properties ?? {};
  const client = live;
  /** Captures a probe event until its stamped props satisfy `ok`, then returns them. */
  const probe = async (ok: (p: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    await until(() => {
      client.capture("probe");
      return ok(last("probe"));
    }, 4000);
    return last("probe");
  };
  return { f, t, client, last, probe };
}

describe("replay sampling (shared vectors)", () => {
  it("matches testdata/replay/sampling.json", () => {
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
    for (const c of vectors.cases) {
      expect(fnv1a32(`${c.session_id}:${c.key}`), c.session_id).toBe(c.hash);
      expect(sampled(c.session_id, c.key, c.rate), `${c.session_id}/${c.key}`).toBe(c.sampled);
    }
  });
});

describe("replay trigger groups", () => {
  it("a remote event group buffers until its event, then records and says why", async () => {
    const remote = { replay_trigger_groups: [{ id: "checkout", events: ["checkout_failed"], sample_rate: 1 }] };
    const { f, client, probe } = boot({ replay: { flush_interval_ms: 40 } }, remote);
    expect((await probe((p) => p.$recording_status === "buffering")).$replay_event_trigger_status).toBe("pending");
    expect(f.posts).toHaveLength(0);
    client.capture("checkout_failed");
    await until(() => f.posts.length > 0);
    expect(f.posts.flatMap((p) => p.chunk.events.map((e) => e.type))).toContain(2);
    const p = await probe((x) => x.$has_recording === true);
    expect(p.$recording_status).toBe("active");
    expect(p.$session_recording_start_reason).toBe("trigger_group_matched");
    expect(p.$replay_trigger_groups_matched).toEqual(["checkout"]);
    expect(p.$replay_event_trigger_status).toBe("activated");
  });

  it("match all needs every condition; a group without conditions records at once", async () => {
    const groups = [{ id: "both", match: "all" as const, events: ["paid"], url_patterns: ["/never-here"] }];
    const a = boot({ replay: { trigger_groups: groups, flush_interval_ms: 40 } });
    await a.probe((p) => p.$recording_status === "buffering");
    a.client.capture("paid");
    expect((await a.probe((p) => p.$replay_event_trigger_status === "activated")).$recording_status).toBe("buffering");
    expect(a.f.posts).toHaveLength(0);
    await live?.shutdown();
    const b = boot({ replay: { trigger_groups: [{ id: "all" }], flush_interval_ms: 40 } });
    await until(() => b.f.posts.length > 0);
    expect(b.f.posts.length).toBeGreaterThan(0);
  });

  it("a group sampled out never records; replay.start(true) bypasses sampling and triggers", async () => {
    const { f, client, probe } = boot({ replay: { trigger_groups: [{ id: "g", sample_rate: 0 }], flush_interval_ms: 40 } });
    await probe((p) => p.$recording_status === "buffering");
    expect(f.posts).toHaveLength(0);
    client.replay.stop();
    await client.replay.start(true);
    await until(() => f.posts.length > 0);
    expect((await probe((p) => p.$recording_status === "active")).$session_recording_start_reason).toBe("trigger_group_matched");
  });

  it("stamps disabled / sampled states", async () => {
    const a = boot({}, { session_recording: false });
    expect((await a.probe((p) => p.$recording_status === "disabled")).$replay_disabled_reason).toBe("remote_disabled");
    await live?.shutdown();
    const b = boot({ replay: { sample_rate: 0 } });
    expect((await b.probe((p) => p.$recording_status === "sampled")).$replay_sample_rate).toBe(0);
  });
});

describe("replay privacy hooks", () => {
  it("maskUrlFn rewrites recorded URLs; maskInputFn rewrites masked input values", async () => {
    history.pushState({}, "", "/account?token=abc123");
    const { f } = boot({
      replay: {
        flush_interval_ms: 40,
        maskUrlFn: (u) => u.replace(/token=[^&]+/, "token=REDACTED"),
        maskInputFn: () => "CUSTOM-MASK",
      },
    });
    await until(() => f.posts.length > 0);
    const all = f.posts.map((p) => p.raw).join("\n");
    expect(all).toContain("token=REDACTED");
    expect(all).not.toContain("abc123");
    expect(all).toContain("CUSTOM-MASK");
    expect(all).not.toContain("SECRET-QUERY");
    history.pushState({}, "", "/");
  });
});

describe("replay config resolution", () => {
  it("remote min duration, mode and canvas toggle; local captureCanvas:false refuses the toggle", () => {
    const r = resolveReplay({}, { replay_min_duration_ms: 2000, replay_min_duration_mode: "session", replay_capture_canvas: true });
    expect(r?.min_duration_ms).toBe(2000);
    expect(r?.min_duration_mode).toBe("session");
    expect(r?.canvas).toEqual({ fps: 2, quality: 0.4 });
    expect(resolveReplay({ captureCanvas: false }, { replay_capture_canvas: true })?.canvas).toBeNull();
    expect(resolveReplay({ min_duration_ms: 0 }, { replay_min_duration_ms: 5000 })?.min_duration_ms).toBe(0);
  });
});

describe("session id helpers", () => {
  it("getSessionId and onSessionId", () => {
    const { client } = boot();
    const seen: string[] = [];
    const off = client.onSessionId((id) => seen.push(id));
    expect(seen).toEqual([client.getSessionId()]);
    off();
  });
});

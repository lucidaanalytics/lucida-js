import { describe, expect, it } from "vitest";
import { Lucida } from "../src/index.js";
import { flag } from "./helpers.js";

/** Fake SSE gateway: the test pushes `definitions` events; definitions content follows `state.defs`. */
function fakeSse() {
  const enc = new TextEncoder();
  const state = { defs: [flag("f", { active: false })], streams: 0, defLoads: 0, failStream: false };
  let ctl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/flags/stream")) {
      state.streams++;
      if (state.failStream) return new Response("", { status: 503 });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            ctl = c;
            init?.signal?.addEventListener("abort", () => c.error(new Error("aborted")));
            c.enqueue(enc.encode('event: definitions\ndata: {"etag":"v0"}\n\n'));
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    }
    if (url.endsWith("/v1/flags/definitions")) {
      state.defLoads++;
      return new Response(JSON.stringify({ flags: state.defs }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return {
    fetch: fetchImpl,
    state,
    push: (etag: string) => ctl?.enqueue(enc.encode(`: keepalive\n\nevent: definitions\ndata: {"etag":"${etag}"}\n\n`)),
    drop: () => ctl?.close(),
  };
}

const until = async (f: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};

const mk = (g: ReturnType<typeof fakeSse>, o = {}) =>
  new Lucida("lc_pk_x", {
    host: "http://gw",
    secretKey: "lc_sk_x",
    fetch: g.fetch,
    featureFlagsPollingIntervalMs: 60_000,
    streamBackoff: { baseMs: 10, maxMs: 20 },
    ...o,
  });

describe("flag SSE stream", () => {
  it("reloads definitions when the server pushes a change", async () => {
    const g = fakeSse();
    const l = mk(g);
    await l.ready;
    expect(await l.isFeatureEnabled("f", "u1")).toBe(false);
    g.state.defs = [flag("f")];
    g.push("v1");
    await until(() => g.state.defLoads >= 3);
    expect(await l.isFeatureEnabled("f", "u1")).toBe(true);
    await l.shutdown();
  });

  it("reconnects with backoff after the stream drops", async () => {
    const g = fakeSse();
    const l = mk(g);
    await l.ready;
    await until(() => g.state.streams === 1);
    g.drop();
    await until(() => g.state.streams === 2);
    g.state.defs = [flag("f")];
    const n = g.state.defLoads;
    g.push("v2");
    await until(() => g.state.defLoads > n);
    expect(await l.isFeatureEnabled("f", "u1")).toBe(true);
    await l.shutdown();
  });

  it("falls back to interval polling while the stream is unavailable", async () => {
    const g = fakeSse();
    g.state.failStream = true;
    const l = mk(g, { featureFlagsPollingIntervalMs: 20 });
    await l.ready;
    const before = g.state.defLoads;
    await until(() => g.state.defLoads >= before + 3);
    expect(g.state.streams).toBeGreaterThan(1); // kept retrying
    await l.shutdown();
  });

  it("does not poll on the interval while the stream is healthy", async () => {
    const g = fakeSse();
    const l = mk(g, { featureFlagsPollingIntervalMs: 20 });
    await l.ready;
    await until(() => g.state.defLoads >= 2); // initial + connect event
    const n = g.state.defLoads;
    await new Promise((r) => setTimeout(r, 120));
    expect(g.state.defLoads).toBe(n);
    await l.shutdown();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createChunker } from "../src/replay/chunker.js";
import { createRing } from "../src/replay/ring.js";
import { decode, replayFetch, until, wait } from "./replay-helpers.js";

const ids = () => ({ sessionId: "s1", windowId: "w1" });
const mk = (f: ReturnType<typeof replayFetch>, over = {}) =>
  createChunker({
    url: "https://x.test/v1/replay",
    apiKey: "k",
    fetch: f.fn,
    ids,
    chunkBytes: 20_000,
    flushMs: 30,
    backoff: { baseMs: 1, random: () => 0 },
    ...over,
  });

afterEach(() => vi.unstubAllGlobals());

// jsdom's Blob has no arrayBuffer()
const blobBytes = (b: Blob): Promise<Uint8Array> =>
  new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(new Uint8Array(r.result as ArrayBuffer));
    r.readAsArrayBuffer(b);
  });

describe("chunker", () => {
  it("splits at the size cap, numbers chunks monotonically, keeps every event, stays under 10 MB", async () => {
    const f = replayFetch();
    const c = mk(f);
    const blob = "x".repeat(5000);
    for (let i = 0; i < 40; i++) c.add({ type: 3, i, blob });
    await c.flush();
    expect(f.posts.length).toBeGreaterThan(5);
    expect(f.posts.map((p) => p.chunk.seq)).toEqual(f.posts.map((_, i) => i));
    expect(f.posts.every((p) => p.raw.length < 10_000_000 && p.raw.length < 20_000 + 6000 + 300)).toBe(true);
    expect(f.posts.flatMap((p) => p.chunk.events)).toHaveLength(40);
    expect(f.posts[0]!.url).toContain("compression=gzip");
    expect(f.posts[0]!.chunk).toMatchObject({ api_key: "k", session_id: "s1", window_id: "w1" });
  });

  it("drops an event the gateway would reject (> 10 MB) instead of poisoning the stream", async () => {
    const f = replayFetch();
    const c = mk(f);
    c.add({ type: 2, big: "y".repeat(10_100_000) });
    c.add({ type: 3 });
    await c.flush();
    expect(f.posts.flatMap((p) => p.chunk.events)).toEqual([{ type: 3 }]);
  });

  it("flushes on the interval", async () => {
    const f = replayFetch();
    mk(f).add({ type: 3 });
    await until(() => f.posts.length === 1);
    expect(f.posts).toHaveLength(1);
  });

  it("retries a failing chunk with backoff, in order, without skipping seq", async () => {
    let n = 0;
    const f = replayFetch({}, () => (n++ < 2 ? 503 : 200));
    const c = mk(f);
    c.add({ type: 3, a: 1 });
    await c.flush();
    c.add({ type: 3, a: 2 });
    await c.flush();
    expect(f.posts.map((p) => p.chunk.seq)).toEqual([0, 1]);
    expect(n).toBe(4);
  });

  it("drops a chunk on a non-retryable status", async () => {
    const f = replayFetch({}, () => 400);
    const c = mk(f);
    c.add({ type: 3 });
    await c.flush();
    expect(f.posts).toHaveLength(0);
    c.add({ type: 3 });
    await c.flush(); // the next chunk still goes out, seq moved on
    expect(c.seq).toBe(2);
  });

  it("sends the rest through sendBeacon (gzipped) on pagehide", async () => {
    const f = replayFetch();
    const beacons: Array<{ url: string; blob: Blob }> = [];
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: (url: string, blob: Blob) => (beacons.push({ url, blob }), true) });
    const c = mk(f, { flushMs: 60_000 });
    c.add({ type: 3, last: true });
    c.beacon();
    expect(beacons).toHaveLength(1);
    expect(beacons[0]!.url).toContain("compression=gzip");
    const p = decode(beacons[0]!.url, await blobBytes(beacons[0]!.blob));
    expect(p.chunk.events).toEqual([{ type: 3, last: true }]);
    expect(f.posts).toHaveLength(0);
  });

  it("holds everything until released (min_duration_ms) and never beacons while held", async () => {
    const f = replayFetch();
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });
    const c = mk(f, { hold: true });
    c.add({ type: 3 });
    await c.flush();
    c.beacon();
    await wait(60);
    expect(f.posts).toHaveLength(0);
    expect(beacon).not.toHaveBeenCalled();
    c.release();
    await until(() => f.posts.length === 1);
    expect(f.posts).toHaveLength(1);
  });

  it("restarts seq and asks for a snapshot when the session rotates", async () => {
    const f = replayFetch();
    let sid = "s1";
    const onSessionChange = vi.fn();
    const c = mk(f, { ids: () => ({ sessionId: sid, windowId: "w" }), onSessionChange });
    c.add({ type: 3 });
    await c.flush();
    sid = "s2";
    c.add({ type: 3 });
    await c.flush();
    expect(f.posts.map((p) => [p.chunk.session_id, p.chunk.seq])).toEqual([
      ["s1", 0],
      ["s2", 0],
    ]);
    expect(onSessionChange).toHaveBeenCalledOnce();
  });
});

describe("ring buffer", () => {
  it("keeps the previous and the current snapshot segment, nothing older", () => {
    const r = createRing<string>();
    r.push("m1", false);
    r.push("f1", false);
    r.push("m2", true);
    r.push("f2", false);
    r.push("m3", true);
    r.push("i3", false);
    expect(r.drain()).toEqual(["m2", "f2", "m3", "i3"]);
    expect(r.size).toBe(0);
  });
});

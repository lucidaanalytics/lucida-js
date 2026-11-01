import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFlagSync } from "../src/index.js";

/** Fake SSE source: each fetch opens a controllable stream; `fail` makes connects return 503. */
function fakeSse() {
  const enc = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const o = { opens: 0, fail: false, auth: "" };
  const fn = (async (_u: string, init?: RequestInit) => {
    o.opens++;
    o.auth = (init?.headers as Record<string, string>).Authorization ?? "";
    if (o.fail) return new Response("no", { status: 503 });
    return new Response(new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) }), { status: 200 });
  }) as unknown as typeof fetch;
  return {
    fn,
    o,
    notice: (etag: string) => ctrl?.enqueue(enc.encode(`event: definitions\ndata: {"etag":"${etag}"}\n\n`)),
    drop: () => ctrl?.close(),
  };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
};

describe("startFlagSync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reloads on a change notice (deduped by etag) using the public key", async () => {
    const s = fakeSse();
    const reload = vi.fn();
    const stop = startFlagSync({ apiHost: "https://h", apiKey: "lc_pk_x", fetch: s.fn, reload });
    await flush();
    s.notice("a");
    await flush();
    s.notice("a");
    s.notice("b");
    await flush();
    expect(reload).toHaveBeenCalledTimes(2);
    expect(s.o.auth).toBe("Bearer lc_pk_x");
    stop();
  });

  it("polls only while the stream is down, and reconnects with backoff", async () => {
    const s = fakeSse();
    const reload = vi.fn();
    const stop = startFlagSync({ apiHost: "https://h", apiKey: "k", fetch: s.fn, reload, pollMs: 1000 });
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload).not.toHaveBeenCalled(); // connected: no polling
    s.o.fail = true;
    s.drop();
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload.mock.calls.length).toBeGreaterThanOrEqual(2); // fell back to polling
    const opens = s.o.opens;
    expect(opens).toBeGreaterThan(1); // retried with backoff
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.o.opens).toBe(opens);
  });

  it("closes the stream while hidden and reloads on return", async () => {
    const s = fakeSse();
    const reload = vi.fn();
    let hidden = false;
    let cb = (): void => {};
    startFlagSync({
      apiHost: "https://h",
      apiKey: "k",
      fetch: s.fn,
      reload,
      pollMs: 1000,
      visibility: { hidden: () => hidden, subscribe: (f) => ((cb = f), () => {}) },
    });
    await flush();
    hidden = true;
    cb();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reload).not.toHaveBeenCalled(); // no polling while hidden
    const opens = s.o.opens;
    hidden = false;
    cb();
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(s.o.opens).toBe(opens + 1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventQueue, backoffDelay, isRetryable, uuidv7 } from "../src/index.js";
import type { WireEvent } from "../src/index.js";
import { FakeTransport } from "./helpers.js";

const ev = (n: number): WireEvent => ({
  uuid: uuidv7(),
  event: `e${n}`,
  distinct_id: "d",
  timestamp: new Date().toISOString(),
  properties: {},
});

describe("EventQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mk = (t: FakeTransport, extra = {}) =>
    new EventQueue({ transport: t, url: "https://h/v1/batch", apiKey: "k", backoff: { random: () => 1 }, ...extra });

  it("flushes at 20 events", async () => {
    const t = new FakeTransport();
    const q = mk(t);
    for (let i = 0; i < 19; i++) q.enqueue(ev(i));
    expect(t.calls).toHaveLength(0);
    q.enqueue(ev(19));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(1);
    expect(JSON.parse(t.calls[0]!.body).batch).toHaveLength(20);
    expect(JSON.parse(t.calls[0]!.body).api_key).toBe("k");
  });

  it("flushes after 5 s", async () => {
    const t = new FakeTransport();
    const q = mk(t);
    q.enqueue(ev(1));
    await vi.advanceTimersByTimeAsync(4999);
    expect(t.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(t.calls).toHaveLength(1);
  });

  it("retries 5xx with exponential backoff then succeeds, keeping events", async () => {
    const t = new FakeTransport();
    t.statuses = [500, 503, 200];
    const q = mk(t);
    q.enqueue(ev(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000); // base 1 s
    expect(t.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(t.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // 2 s
    expect(t.calls).toHaveLength(3);
    expect(q.size).toBe(0);
    expect(t.events().map((e) => e.event)).toEqual(["e1", "e1", "e1"]);
  });

  it("drops on 4xx without retry", async () => {
    const t = new FakeTransport();
    t.statuses = [400];
    const dropped: string[] = [];
    const q = mk(t, { onDrop: (_: unknown, r: string) => dropped.push(r) });
    q.enqueue(ev(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.calls).toHaveLength(1);
    expect(dropped).toEqual(["status_400"]);
  });

  it("drops oldest when over max size", () => {
    const t = new FakeTransport();
    const dropped: WireEvent[] = [];
    const q = mk(t, { maxQueueSize: 3, flushAt: 100, onDrop: (e: WireEvent[]) => dropped.push(...e) });
    for (let i = 0; i < 5; i++) q.enqueue(ev(i));
    expect(q.size).toBe(3);
    expect(dropped.map((e) => e.event)).toEqual(["e0", "e1"]);
  });

  it("beacon flush is one-shot and flagged", async () => {
    const t = new FakeTransport();
    t.statuses = [500];
    const q = mk(t);
    q.enqueue(ev(1));
    await q.flush({ beacon: true });
    expect(t.calls[0]!.beacon).toBe(true);
    expect(q.size).toBe(0);
  });

  it("shutdown flushes then ignores new events", async () => {
    const t = new FakeTransport();
    const q = mk(t);
    q.enqueue(ev(1));
    await q.shutdown();
    q.enqueue(ev(2));
    expect(t.calls).toHaveLength(1);
    expect(q.size).toBe(0);
  });
});

describe("backoff", () => {
  it("grows exponentially, is capped, jitters within 50-100%", () => {
    expect(backoffDelay(0, { random: () => 1 })).toBe(1000);
    expect(backoffDelay(3, { random: () => 1 })).toBe(8000);
    expect(backoffDelay(10, { random: () => 1 })).toBe(30_000);
    expect(backoffDelay(2, { random: () => 0 })).toBe(2000);
    expect(isRetryable(0) && isRetryable(429) && isRetryable(500)).toBe(true);
    expect(isRetryable(400) || isRetryable(401)).toBe(false);
  });
});

describe("uuidv7", () => {
  it("is v7 formatted and monotonic", () => {
    const ids = Array.from({ length: 50 }, () => uuidv7(1_700_000_000_000));
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
  });
});

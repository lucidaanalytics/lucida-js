import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterventionStream, sseParser } from "../src/index.js";
import type { Intervention } from "../src/index.js";

const fire = (seq: number, id = `f${seq}`) => ({ seq, id, intervention_id: "i1", name: "Rescue", event: "checkout_error", payload: { msg: "hi" }, fired_at: "2026-11-01T00:00:00Z" });
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
};

describe("InterventionStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers each streamed fire once and resumes after the last one", async () => {
    const enc = new TextEncoder();
    let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
    const urls: string[] = [];
    const fetchFn = (async (u: string) => {
      urls.push(u);
      return new Response(new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) }), { status: 200 });
    }) as unknown as typeof fetch;
    const got: Intervention[] = [];
    const s = new InterventionStream({ apiHost: "https://h", apiKey: "lc_pk_x", fetch: fetchFn, distinctId: () => "u 1", onIntervention: (i) => got.push(i), backoff: { baseMs: 10, random: () => 0 } });
    s.start();
    await flush();
    const send = (x: ReturnType<typeof fire>) => ctrl?.enqueue(enc.encode(`id: ${x.seq}\nevent: intervention\ndata: ${JSON.stringify(x)}\n\n`));
    send(fire(1));
    send(fire(1)); // replayed: dropped
    send(fire(2));
    await flush();
    expect(got.map((g) => g.id)).toEqual(["f1", "f2"]);
    expect(urls[0]).toBe("https://h/v1/interventions/stream?distinct_id=u%201");
    ctrl?.close();
    await flush();
    await vi.advanceTimersByTimeAsync(50);
    expect(urls[1]).toBe("https://h/v1/interventions/stream?distinct_id=u%201&cursor=2");
    s.restart();
    await flush();
    expect(urls.at(-1)).toBe("https://h/v1/interventions/stream?distinct_id=u%201");
    s.stop();
  });

  it("polls where the response has no readable body, and stops on 404", async () => {
    const urls: string[] = [];
    let gone = false;
    const fetchFn = (async (u: string) => {
      urls.push(u);
      if (gone) return new Response("", { status: 404 });
      if (u.includes("/stream")) return { ok: true, status: 200, body: null } as unknown as Response;
      return new Response(JSON.stringify({ data: [fire(3)], next_cursor: "3" }), { status: 200 });
    }) as unknown as typeof fetch;
    const got: Intervention[] = [];
    const s = new InterventionStream({ apiHost: "https://h", apiKey: "k", fetch: fetchFn, distinctId: () => "u1", onIntervention: (i) => got.push(i), pollMs: 1000 });
    s.start();
    await flush();
    expect(got.map((g) => g.seq)).toEqual([3]);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(urls.slice(1)).toEqual(["https://h/v1/interventions?distinct_id=u1", "https://h/v1/interventions?distinct_id=u1&cursor=3"]);
    expect(got).toHaveLength(1);
    gone = true;
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    const n = urls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(urls.length).toBe(n);
  });

  it("parses the SSE id field", () => {
    const out: unknown[] = [];
    sseParser((m) => out.push(m))("id: 7\nevent: intervention\ndata: {}\n\n");
    expect(out).toEqual([{ event: "intervention", data: "{}", id: "7" }]);
  });
});

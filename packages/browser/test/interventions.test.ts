import { describe, expect, it, vi } from "vitest";
import { init } from "../src/index.js";
import type { Intervention } from "../src/index.js";
import { fakeTransport } from "./helpers.js";

describe("interventions (N-ANA-2)", () => {
  it("opens the stream on the first listener and reconnects for a new person", async () => {
    const enc = new TextEncoder();
    let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
    const streams: string[] = [];
    const fetchFn = (async (url: string) => {
      if (url.includes("/v1/interventions/stream")) {
        streams.push(url);
        return new Response(new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const client = init("lc_pk_test", { persistence: "memory", apiHost: "https://ingest.test", transport: fakeTransport(), fetch: fetchFn, capturePageview: false, autocapture: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(streams).toHaveLength(0);
    const got: Intervention[] = [];
    const off = client.onIntervention((i) => got.push(i));
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    expect(streams[0]).toContain(`distinct_id=${encodeURIComponent(client.distinctId)}`);
    const fire = { seq: 1, id: "f1", intervention_id: "i1", name: "Rescue", event: "checkout_error", payload: { msg: "Need help?" }, fired_at: "2026-11-01T00:00:00Z" };
    ctrl!.enqueue(enc.encode(`id: 1\nevent: intervention\ndata: ${JSON.stringify(fire)}\n\n`));
    await vi.waitFor(() => expect(got.map((g) => g.payload)).toEqual([{ msg: "Need help?" }]));
    client.identify("user-42");
    await vi.waitFor(() => expect(streams.at(-1)).toContain("distinct_id=user-42"));
    off();
    await client.shutdown();
  });
});

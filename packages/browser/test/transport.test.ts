import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { browserTransport } from "../src/transport.js";

function spyFetch() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fn };
}

describe("browserTransport", () => {
  it("gzips large bodies and flags them with ?compression=gzip", async () => {
    const f = spyFetch();
    const body = JSON.stringify({ batch: Array.from({ length: 50 }, (_, i) => ({ event: "e", i })) });
    const r = await browserTransport(f.fn).send("https://h/v1/batch", body);
    expect(r.status).toBe(200);
    expect(f.calls[0]!.url).toBe("https://h/v1/batch?compression=gzip");
    const sent = f.calls[0]!.body as Uint8Array;
    expect(sent.length).toBeLessThan(body.length);
    expect(gunzipSync(sent).toString()).toBe(body);
  });

  it("leaves small bodies, disabled compression and beacons uncompressed", async () => {
    const f = spyFetch();
    await browserTransport(f.fn).send("https://h/v1/batch", "{}");
    expect(f.calls[0]).toEqual({ url: "https://h/v1/batch", body: "{}" });
    const big = "x".repeat(5000);
    await browserTransport(f.fn, { compress: false }).send("https://h/v1/batch", big);
    expect(f.calls[1]!.body).toBe(big);
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    await browserTransport(f.fn).send("https://h/v1/batch", big, { beacon: true });
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(2);
  });

  it("falls back to plain when CompressionStream is missing", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const f = spyFetch();
    const big = "y".repeat(5000);
    await browserTransport(f.fn).send("https://h/v1/batch", big);
    expect(f.calls[0]).toEqual({ url: "https://h/v1/batch", body: big });
    vi.unstubAllGlobals();
  });
});

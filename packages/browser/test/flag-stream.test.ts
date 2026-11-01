import { describe, expect, it, vi } from "vitest";
import { init } from "../src/index.js";
import { fakeTransport } from "./helpers.js";

describe("flags: change stream (G32)", () => {
  it("refetches flags for the current distinct id on a change notice", async () => {
    const enc = new TextEncoder();
    let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
    const calls: Array<{ url: string; body?: string }> = [];
    let n = 0;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init?.body ? { body: init.body as string } : {}) });
      if (url.endsWith("/v1/flags/stream")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer lc_pk_test");
        return new Response(new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) }), { status: 200 });
      }
      return new Response(JSON.stringify({ flags: { a: { enabled: true, value: ++n > 1 } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = init("lc_pk_test", {
      persistence: "memory",
      apiHost: "https://ingest.test",
      transport: fakeTransport(),
      fetch: fetchFn,
      capturePageview: false,
      autocapture: false,
      flagStream: { pollMs: 0 },
    });
    await vi.waitFor(() => expect(client.getFlag("a")).toBe(false));
    ctrl!.enqueue(enc.encode('event: definitions\ndata: {"etag":"e1"}\n\n'));
    await vi.waitFor(() => expect(client.getFlag("a")).toBe(true));
    const posts = calls.filter((c) => c.url.endsWith("/v1/flags"));
    expect(posts.length).toBe(2);
    expect(JSON.parse(posts[1]!.body!).distinct_id).toBe(client.distinctId);
    await client.shutdown();
  });
});

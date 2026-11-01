import { describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";

describe("react-native flag stream (G32)", () => {
  it("refetches on a change notice and stops on shutdown", async () => {
    const enc = new TextEncoder();
    let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
    let posts = 0;
    const fetchFn = (async (url: string) => {
      if (url.endsWith("/v1/flags/stream")) {
        return new Response(new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) }), { status: 200 });
      }
      posts++;
      return new Response(JSON.stringify({ flags: { a: { enabled: true, value: posts > 1 } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = await createClient("lc_pk_test", {
      apiHost: "https://ingest.test",
      fetch: fetchFn,
      flagStream: { pollMs: 0 },
      transport: { send: async () => ({ status: 200 }) },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(client.getFlag("a")).toBe(false);
    ctrl!.enqueue(enc.encode('event: definitions\ndata: {"etag":"x"}\n\n'));
    await new Promise((r) => setTimeout(r, 30));
    expect(client.getFlag("a")).toBe(true);
    await client.shutdown();
  });
});

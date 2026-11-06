import { describe, expect, it } from "vitest";
import { nodeTransport } from "../src/transport.js";

const send = (r: Response | object) =>
  nodeTransport({ fetch: (async () => r) as unknown as typeof fetch, timeoutMs: 1000 }).send("https://h/v1/batch", "{}");

describe("nodeTransport", () => {
  it("reads Retry-After seconds as retryAfterMs", async () => {
    const r = await send(new Response("", { status: 429, headers: { "Retry-After": "7" } }));
    expect(r).toEqual({ status: 429, retryAfterMs: 7000 });
  });

  it("has no retryAfterMs without the header, or when the response has no headers at all", async () => {
    expect(await send(new Response("", { status: 503 }))).toEqual({ status: 503 });
    expect(await send({ status: 200 })).toEqual({ status: 200 });
  });
});

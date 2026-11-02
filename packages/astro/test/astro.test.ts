import { describe, expect, it } from "vitest";
import { createEdgeClient } from "@lucida-analytics/edge";
import { bootstrapScript, lucidaMiddleware } from "../src/index.js";

const fetchStub = (async () =>
  new Response(JSON.stringify({ flags: { on: { enabled: true, value: true } } }))) as unknown as typeof fetch;
const client = createEdgeClient({ apiKey: "pk", fetch: fetchStub });

describe("astro middleware", () => {
  it("fills locals and sets the cookie only with consent", async () => {
    const mw = lucidaMiddleware({ client });
    const locals: Record<string, unknown> = {};
    const res = await mw({ request: new Request("https://x/", { headers: { cookie: "lc_consent=granted" } }), locals }, async () => new Response("ok"));
    expect((locals.lucida as { flags: unknown }).flags).toEqual({ on: true });
    expect(res.headers.get("set-cookie")).toContain("lc_distinct_id=");
    const res2 = await mw({ request: new Request("https://x/"), locals: {} }, async () => new Response("ok"));
    expect(res2.headers.get("set-cookie")).toBeNull();
  });
  it("escapes the bootstrap script", () => {
    expect(bootstrapScript({ distinctId: "</script>", flags: {} })).not.toContain("</script>");
  });
});

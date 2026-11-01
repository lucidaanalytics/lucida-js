import { describe, expect, it } from "vitest";
import { createLucida } from "../src/index.js";

const fetchStub = (async () =>
  new Response(JSON.stringify({ flags: { on: { enabled: true, value: true } } }))) as unknown as typeof fetch;

describe("remix loader helper", () => {
  const lucida = createLucida({ apiKey: "pk", fetch: fetchStub });
  it("reuses the cookie id and sets nothing", async () => {
    const r = await lucida.load(new Request("https://x/", { headers: { cookie: "lc_distinct_id=abc" } }));
    expect(r.bootstrap).toEqual({ distinctId: "abc", flags: { on: true } });
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("mints and persists an id once consent is granted", async () => {
    const r = await lucida.load(new Request("https://x/", { headers: { cookie: "lc_consent=granted" } }));
    expect(r.headers.get("set-cookie")).toContain(r.bootstrap.distinctId);
  });
});

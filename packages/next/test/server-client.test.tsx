import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LucidaNextProvider, LucidaPagesProvider, useFeatureFlag } from "../src/client.js";
import { lucidaServer, nodeEvaluator } from "../src/server.js";

function Flag({ k }: { k: string }) {
  return <span>{String(useFeatureFlag(k))}</span>;
}

describe("client providers (SSR)", () => {
  it("first server render already has the bootstrapped variant (no flicker)", () => {
    const html = renderToString(
      <LucidaNextProvider apiKey="lc_pk_x" bootstrap={{ distinctId: "a", flags: { nav: "b" } }}>
        <Flag k="nav" />
      </LucidaNextProvider>,
    );
    expect(html).toContain("<span>b</span>");
  });
  it("Pages Router provider reads __lucida from pageProps", () => {
    const html = renderToString(
      <LucidaPagesProvider apiKey="lc_pk_x" pageProps={{ __lucida: { distinctId: "a", flags: { nav: "c" } } }}>
        <Flag k="nav" />
      </LucidaPagesProvider>,
    );
    expect(html).toContain("<span>c</span>");
  });
});

describe("server (node SDK)", () => {
  const defs = { flags: [{ key: "ship", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" }, conditions: [{ rollout_pct: 100 }] }] };
  const fetchImpl = (async (url: string) => {
    if (url.endsWith("/v1/flags/stream")) return new Response("", { status: 404 });
    if (url.endsWith("/v1/flags/definitions")) return new Response(JSON.stringify(defs), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  it("evaluates locally with streamed definitions, and shares one client per key", async () => {
    const o = { apiKey: "lc_pk_srv", secretKey: "lc_sk_x", host: "http://gw", node: { fetch: fetchImpl, streamBackoff: { baseMs: 10_000, maxMs: 10_000 } } };
    expect(lucidaServer(o)).toBe(lucidaServer(o));
    expect(await nodeEvaluator(o)("u1")).toEqual({ ship: true });
    await lucidaServer(o).shutdown();
  });
});

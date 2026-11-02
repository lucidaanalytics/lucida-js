import type { Client } from "@lucida-analytics/browser";
import { LucidaProvider } from "@lucida-analytics/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createEdgeClient, LucidaPageviews, lucidaBootstrap, lucidaMiddleware, lucidaServerContext, routeIdTemplate, trackRouter } from "../src/index.js";
import type { TanstackRouterLike } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeRouter(routeId = "/posts/$postId") {
  const subs: Array<(e: { toLocation: { pathname: string }; pathChanged?: boolean; hrefChanged?: boolean }) => void> = [];
  const router: TanstackRouterLike = {
    state: { location: { pathname: "/posts/1" }, matches: [{ routeId: "__root__" }, { routeId }] },
    subscribe: (_ev, fn) => (subs.push(fn), () => void subs.splice(0)),
  };
  return { router, subs, go: (routeId: string, extra = {}) => ((router.state as { matches: unknown }).matches = [{ routeId: "__root__" }, { routeId }], subs.forEach((f) => f({ toLocation: { pathname: "/x" }, ...extra }))) };
}

describe("routeIdTemplate", () => {
  it("drops pathless layouts and the root, keeps params", () => {
    expect(routeIdTemplate("/_authed/posts/$postId/")).toBe("/posts/$postId");
    expect(routeIdTemplate("__root__")).toBe("/");
    expect(routeIdTemplate(undefined)).toBe("/");
    expect(routeIdTemplate("/")).toBe("/");
  });
});

describe("trackRouter", () => {
  it("sends the current page, then one view per resolved navigation, skipping no-op resolutions", () => {
    const { router, go, subs } = fakeRouter();
    const capture = vi.fn();
    const off = trackRouter(router, { capture });
    expect(capture).toHaveBeenCalledWith("$pageview", { $route: "/posts/$postId" });
    go("/about");
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1]![1]).toMatchObject({ $route: "/about", $referrer: expect.any(String) });
    go("/about", { pathChanged: false, hrefChanged: false });
    expect(capture).toHaveBeenCalledTimes(2);
    off();
    expect(subs).toHaveLength(0);
  });

  it("LucidaPageviews subscribes through the provider's client", async () => {
    const { router, subs } = fakeRouter();
    const capture = vi.fn();
    const client = { capture, getFlag: () => undefined, onFlags: () => () => {} } as unknown as Client;
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(
        <LucidaProvider client={client}>
          <LucidaPageviews router={router} />
        </LucidaProvider>,
      ),
    );
    expect(capture).toHaveBeenCalledTimes(1);
    expect(subs).toHaveLength(1);
    await act(async () => root.unmount());
    expect(subs).toHaveLength(0);
  });
});

describe("server helpers", () => {
  it("lucidaMiddleware passes the request context to next()", () => {
    const req = new Request("https://app.test/x", { headers: { "x-lucida-distinct-id": "d9" } });
    const got = lucidaMiddleware()({ request: req, next: (o) => o.context });
    expect(got.lucida.distinctId).toBe("d9");
  });

  it("lucidaServerContext builds the visitor and request props", () => {
    const req = new Request("https://app.test/api/x", { method: "PUT", headers: { "x-lucida-distinct-id": "d9", "x-lucida-session-id": "s9", "user-agent": "UA" } });
    const { lucida } = lucidaServerContext(req, { remoteAddr: "1.2.3.4" });
    expect(lucida).toMatchObject({ distinctId: "d9", sessionId: "s9", props: { $request_method: "PUT", $request_path: "/api/x", $ip: "1.2.3.4", $user_agent: "UA" } });
  });

  it("lucidaBootstrap mints an id with a Set-Cookie header when consent allows", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ flags: { f: { enabled: true, value: true } } }), { status: 200 })) as unknown as typeof fetch;
    const client = createEdgeClient({ apiKey: "lc_pk_x", host: "https://gw.test", fetch: fetchImpl });
    const { bootstrap, headers } = await lucidaBootstrap(client, new Request("https://app.test/"), { consentMode: "off" });
    expect(bootstrap.distinctId).toBeTruthy();
    expect(bootstrap.flags).toEqual({ f: true });
    expect(headers.get("set-cookie")).toContain(bootstrap.distinctId);
    const none = await lucidaBootstrap(client, new Request("https://app.test/"), { consentMode: "opt_in" });
    expect(none.headers.get("set-cookie")).toBeNull();
  });
});

import type { Client } from "@lucida-analytics/browser";
import { LucidaProvider } from "@lucida-analytics/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LucidaPageviews, lucidaRequestContext, routeTemplateFromMatches, trackRouter } from "../src/index.js";
import type { DataRouterLike } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => history.replaceState({}, "", "/"));

describe("routeTemplateFromMatches", () => {
  it("joins route paths, skipping pathless and index routes; absolute paths restart", () => {
    const m = (path?: string, index = false) => ({ route: { path, index } });
    expect(routeTemplateFromMatches([m(), m("blog"), m(":slug")])).toBe("/blog/:slug");
    expect(routeTemplateFromMatches([m("/"), m(undefined, true)])).toBe("/");
    expect(routeTemplateFromMatches([m("a"), m("/b/:id")])).toBe("/b/:id");
    expect(routeTemplateFromMatches([])).toBe("/");
  });
});

describe("LucidaPageviews", () => {
  it("captures a pageview per navigation (path or search) with $route and the previous URL", async () => {
    const capture = vi.fn();
    const client = { capture, getFlag: () => undefined, onFlags: () => () => {} } as unknown as Client;
    const el = document.createElement("div");
    const root = createRoot(el);
    const render = (p: { pathname: string; search?: string; template?: string }) =>
      act(async () =>
        root.render(
          <LucidaProvider client={client}>
            <LucidaPageviews {...p} />
          </LucidaProvider>,
        ),
      );
    await render({ pathname: "/blog/a", template: "/blog/:slug" });
    await render({ pathname: "/blog/a", template: "/blog/:slug" }); // no change: nothing
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenLastCalledWith("$pageview", { $route: "/blog/:slug" });
    history.pushState({}, "", "/blog/a?page=2");
    await render({ pathname: "/blog/a", search: "?page=2", template: "/blog/:slug" });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1]![1]).toMatchObject({ $route: "/blog/:slug", $referrer: expect.stringMatching(/\/$/) });
    await render({ pathname: "/plain" });
    expect(capture.mock.calls[2]![1]).not.toHaveProperty("$route");
  });
});

describe("trackRouter", () => {
  it("captures the first view and each distinct completed location", () => {
    const subs: Array<(s: DataRouterLike["state"]) => void> = [];
    const state = (pathname: string, path: string) => ({ location: { pathname, search: "" }, matches: [{ route: { path } }] });
    const router: DataRouterLike = { state: state("/u/1", "/u/:id"), subscribe: (f) => (subs.push(f), () => subs.splice(0)) };
    const capture = vi.fn();
    const off = trackRouter(router, { capture });
    expect(capture).toHaveBeenCalledWith("$pageview", { $route: "/u/:id" });
    subs[0]!(state("/u/1", "/u/:id")); // revalidation, same location
    expect(capture).toHaveBeenCalledTimes(1);
    subs[0]!(state("/u/2", "/u/:id"));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1]![1]).toHaveProperty("$referrer");
    off();
    expect(subs).toHaveLength(0);
  });
});

describe("lucidaRequestContext", () => {
  it("reads tracing headers and request props from a Fetch Request", () => {
    const req = new Request("https://app.test/items/3?x=1", {
      method: "post",
      headers: { "x-lucida-distinct-id": "d1", "x-lucida-session-id": "s1", "user-agent": "UA", "x-forwarded-for": "7.7.7.7" },
    });
    const ctx = lucidaRequestContext(req, { trustProxy: true });
    expect(ctx).toMatchObject({ distinctId: "d1", sessionId: "s1", props: { $request_method: "POST", $request_path: "/items/3", $user_agent: "UA", $ip: "7.7.7.7" } });
    expect(lucidaRequestContext(req, { remoteAddr: "10.1.1.1" }).props.$ip).toBe("10.1.1.1");
  });
});

// @vitest-environment jsdom
import type { Client } from "@lucida/browser";
import { LucidaProvider } from "@lucida/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ pathname: "/", params: {} as Record<string, string | string[]> }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useParams: () => nav.params }));

import { LucidaPagesRouteViews, LucidaRouteViews } from "../src/route-views.js";

describe("route views", () => {
  beforeEach(() => history.replaceState({}, "", "/"));

  async function mount(ui: React.ReactNode, client: Client) {
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<LucidaProvider client={client}>{ui}</LucidaProvider>));
    return { root, rerender: (n: React.ReactNode) => act(async () => root.render(<LucidaProvider client={client}>{n}</LucidaProvider>)) };
  }

  it("App Router: one $pageview per navigation with $route and the previous URL as referrer", async () => {
    const capture = vi.fn();
    const client = { capture, getFlag: () => undefined, onFlags: () => () => {} } as unknown as Client;
    nav.pathname = "/blog/hello";
    nav.params = { slug: "hello" };
    const m = await mount(<LucidaRouteViews />, client);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenLastCalledWith("$pageview", { $route: "/blog/[slug]" });
    nav.pathname = "/blog/second";
    nav.params = { slug: "second" };
    history.pushState({}, "", "/blog/second");
    await m.rerender(<LucidaRouteViews />);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1]![1]).toMatchObject({ $route: "/blog/[slug]", $referrer: expect.stringContaining("/") });
  });

  it("Pages Router: uses router.pathname as the template", async () => {
    const capture = vi.fn();
    const client = { capture, getFlag: () => undefined, onFlags: () => () => {} } as unknown as Client;
    await mount(<LucidaPagesRouteViews router={{ pathname: "/posts/[id]", asPath: "/posts/5?x=1" }} />, client);
    expect(capture).toHaveBeenCalledWith("$pageview", { $route: "/posts/[id]" });
  });
});

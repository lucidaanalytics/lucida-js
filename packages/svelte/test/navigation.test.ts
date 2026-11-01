import { describe, expect, it } from "vitest";
import { routeTemplateOf, trackNavigation } from "../src/index.js";
import type { NavigationLike } from "../src/index.js";

describe("trackNavigation", () => {
  it("drops layout groups from the route id", () => {
    expect(routeTemplateOf("/(app)/posts/[id]")).toBe("/posts/[id]");
    expect(routeTemplateOf("/")).toBe("/");
    expect(routeTemplateOf(null)).toBe("/");
    expect(routeTemplateOf("/(marketing)/(promo)/sale")).toBe("/sale");
  });

  it("captures the entry page and each navigation with $route and $referrer, nothing on leave", () => {
    let cb: (n: NavigationLike) => void = () => {};
    const seen: Array<[string, Record<string, unknown> | undefined]> = [];
    trackNavigation((fn) => (cb = fn), { capture: (e, p) => void seen.push([e, p]) });
    const to = (id: string | null, href: string) => ({ route: { id }, url: { href } });
    cb({ type: "enter", from: null, to: to("/", "https://a.test/") });
    cb({ type: "goto", from: { url: { href: "https://a.test/" } }, to: to("/(app)/posts/[id]", "https://a.test/posts/7") });
    cb({ type: "leave", from: { url: { href: "https://a.test/posts/7" } }, to: null });
    expect(seen).toEqual([
      ["$pageview", { $route: "/" }],
      ["$pageview", { $route: "/posts/[id]", $referrer: "https://a.test/" }],
    ]);
  });

  it("is a no-op without a client (SSR)", () => {
    let cb: (n: NavigationLike) => void = () => {};
    trackNavigation((fn) => (cb = fn), null);
    expect(() => cb({ type: "enter", to: { route: { id: "/" }, url: { href: "x" } } })).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { getRequestContext, HEADER_CTX, lucidaMiddleware, routeTemplate } from "../src/index.js";
import type { RequestLike } from "../src/index.js";

describe("routeTemplate", () => {
  it("replaces dynamic segments with [name] and catch-alls with [...name]", () => {
    expect(routeTemplate("/blog/hello/comments/7", { slug: "hello", id: "7" })).toBe("/blog/[slug]/comments/[id]");
    expect(routeTemplate("/docs/a/b/c", { path: ["a", "b", "c"] })).toBe("/docs/[...path]");
    expect(routeTemplate("/", {})).toBe("/");
    expect(routeTemplate("/a/a", { x: "a", y: "a" })).toBe("/[x]/[y]");
    expect(routeTemplate("/u/caf%C3%A9", { name: "café" })).toBe("/u/[name]");
    expect(routeTemplate("/static", { missing: "nope", gone: undefined as never })).toBe("/static");
  });
});

describe("getRequestContext / lucidaMiddleware", () => {
  const mk = (headers: Record<string, string>, extra: Partial<RequestLike> = {}): RequestLike => ({
    headers: new Headers(headers),
    cookies: { get: () => undefined },
    ...extra,
  });
  const o = { apiKey: "k", evaluate: async () => ({}), middleware: true };

  it("stamps request props and the tracing ids, forwarded for server components", async () => {
    const lc = await lucidaMiddleware(
      mk({ "x-lucida-distinct-id": "u7", "x-lucida-session-id": "s7", "user-agent": "UA", "x-forwarded-for": "8.8.8.8, 1.1.1.1" }, { url: "https://app.test/p/1?x=1", method: "GET" }),
      { ...o, trustProxy: true },
    );
    expect(lc.context).toMatchObject({
      distinctId: "u7",
      sessionId: "s7",
      props: { $current_url: "https://app.test/p/1?x=1", $request_method: "GET", $request_path: "/p/1", $user_agent: "UA", $ip: "8.8.8.8" },
    });
    const ctx = getRequestContext(lc.requestHeaders, o);
    expect(ctx).toEqual(lc.context);
  });

  it("falls back to the cookie id, overwrites a client-sent context header, and derives from headers without middleware", async () => {
    const req = mk({ [HEADER_CTX]: '{"props":{"$ip":"6.6.6.6"}}' }, { url: "/x", method: "POST" });
    req.cookies = { get: (n: string) => (n === "lc_distinct_id" ? { value: "anon-9" } : undefined) };
    const lc = await lucidaMiddleware(req, o);
    expect(lc.context.distinctId).toBe("anon-9");
    expect(lc.context.props.$ip).toBeUndefined();
    const spoofed = new Headers({ [HEADER_CTX]: '{"props":{"$ip":"6.6.6.6"}}', "user-agent": "real" });
    const derived = getRequestContext(spoofed, { middleware: false }, { url: "/y", method: "put" });
    expect(derived.props).toMatchObject({ $user_agent: "real", $request_method: "PUT", $request_path: "/y" });
    expect(derived.props.$ip).toBeUndefined();
  });
});


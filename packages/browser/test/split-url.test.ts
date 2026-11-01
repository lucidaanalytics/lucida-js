import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flags } from "../src/flags/index.js";
import { splitTarget, splitUrl } from "../src/experiments/index.js";
import type { Client } from "../src/index.js";
import { startWith } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  document.head.innerHTML = "";
});
beforeEach(() => localStorage.clear());

const at = (path: string) => new URL(path, "https://shop.test");
const split = (url: string) => ({ lc_split_url: { url } });

describe("splitTarget", () => {
  it("preserves the visitor query and hash, the variant's own params win, and marks the target", () => {
    const t = splitTarget(split("/pricing-b?plan=pro"), "exp", at("/pricing?utm=x&plan=free#faq"))!;
    expect(t.pathname).toBe("/pricing-b");
    expect(t.searchParams.get("utm")).toBe("x");
    expect(t.searchParams.get("plan")).toBe("pro");
    expect(t.searchParams.get("__lc_split")).toBe("exp");
    expect(t.hash).toBe("#faq");
  });
  it("never redirects to the same page, onto an already-split page, or to unsafe/foreign URLs", () => {
    expect(splitTarget(split("/pricing"), "exp", at("/pricing"))).toBeNull();
    expect(splitTarget(split("/b"), "exp", at("/a?__lc_split=exp"))).toBeNull();
    expect(splitTarget(split("javascript:alert(1)"), "exp", at("/a"))).toBeNull();
    expect(splitTarget(split("https://evil.test/x"), "exp", at("/a"))).toBeNull();
    expect(splitTarget(split("https://b.shop.test/x"), "exp", at("/a"), ["https://b.shop.test"])?.origin).toBe("https://b.shop.test");
    expect(splitTarget({}, "exp", at("/a"))).toBeNull(); // control variant: no url
  });
});

describe("splitUrl module", () => {
  const flagsResp = (value: string, payload: unknown) => ({ flags: { exp: { variant: value, value, payload } } });

  it("redirects the assigned variant once, emitting the exposure before navigating", async () => {
    history.replaceState({}, "", "/pricing?utm=x#top");
    const nav: string[] = [];
    const { client, t } = startWith([flags, splitUrl], {
      _h: { "/v1/flags": flagsResp("b", split("/pricing-b")) },
      splitUrl: { navigate: (u: string) => nav.push(u) },
    } as never);
    live = client;
    await vi.waitFor(() => expect(nav).toHaveLength(1));
    const u = new URL(nav[0]!);
    expect([u.pathname, u.searchParams.get("utm"), u.hash]).toEqual(["/pricing-b", "x", "#top"]);
    expect(t.events().some((e) => e.event === "$exposure" && e.properties.$feature_flag === "exp")).toBe(true);
  });

  it("does not redirect the control variant and lifts the anti-flicker veil", async () => {
    history.replaceState({}, "", "/pricing");
    const nav: string[] = [];
    const { client } = startWith([flags, splitUrl], {
      _h: { "/v1/flags": flagsResp("control", {}) },
      splitUrl: { navigate: (u: string) => nav.push(u), antiFlickerMs: 500 },
    } as never);
    live = client;
    expect(document.head.querySelector("style")).not.toBeNull();
    await vi.waitFor(() => expect(document.head.querySelector("style")).toBeNull());
    expect(nav).toEqual([]);
  });

  it("on the variant page it strips the marker and does not loop", async () => {
    history.replaceState({}, "", "/pricing-b?utm=x&__lc_split=exp");
    const nav: string[] = [];
    const { client } = startWith([flags, splitUrl], {
      _h: { "/v1/flags": flagsResp("b", split("/pricing")) },
      splitUrl: { navigate: (u: string) => nav.push(u) },
    } as never);
    live = client;
    await vi.waitFor(() => expect(location.search).toBe("?utm=x"));
    expect(nav).toEqual([]);
  });
});

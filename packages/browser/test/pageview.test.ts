import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => history.replaceState({}, "", "/home"));
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
});

const set = (obj: object, key: string, value: number): void => {
  Object.defineProperty(obj, key, { value, configurable: true, writable: true });
};

describe("SPA pageviews", () => {
  it("history mode: initial + pushState + replaceState + popstate, with pageleave before each", async () => {
    const { client, t } = start({ autocapture: false });
    live = client;
    history.pushState({}, "", "/products");
    history.replaceState({}, "", "/products/1");
    history.pushState({}, "", "/products/1"); // same URL: nothing
    window.dispatchEvent(new PopStateEvent("popstate"));
    history.pushState({}, "", "/cart");
    await client.flush();
    const seq = t.events().map((e) => `${e.event}:${new URL(e.properties.$current_url as string).pathname}`);
    expect(seq).toEqual([
      "$pageview:/home",
      "$pageleave:/home",
      "$pageview:/products",
      "$pageleave:/products",
      "$pageview:/products/1",
      "$pageleave:/products/1",
      "$pageview:/cart",
    ]);
    const second = t.events()[2]!;
    expect(second.properties.$referrer).toBe("http://localhost:3000/home");
  });

  it("capturePageview:true is initial only", async () => {
    const { client, t } = start({ autocapture: false, capturePageview: true });
    live = client;
    history.pushState({}, "", "/other");
    await client.flush();
    expect(t.events().map((e) => e.event)).toEqual(["$pageview"]);
  });

  it("capturePageview:false captures nothing", async () => {
    const { client, t } = start({ autocapture: false, capturePageview: false });
    live = client;
    history.pushState({}, "", "/other");
    await client.flush();
    expect(t.events()).toHaveLength(0);
  });

  it("shutdown restores history methods", async () => {
    const orig = history.pushState;
    const { client } = start({ autocapture: false });
    expect(history.pushState).not.toBe(orig);
    await client.shutdown();
    expect(history.pushState).toBe(orig);
  });
});

describe("pageleave and scroll depth", () => {
  it("reports max scroll percent and px on pagehide", async () => {
    set(document.documentElement, "scrollHeight", 2000);
    set(window, "innerHeight", 500);
    set(window, "scrollY", 0);
    const { client, t } = start({ autocapture: false });
    live = client;
    set(window, "scrollY", 1000); // bottom = 1500 -> 75%
    window.dispatchEvent(new Event("scroll"));
    set(window, "scrollY", 200); // scrolled back up: max must stay
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide")); // only once
    const leaves = t.calls.flatMap((c) => JSON.parse(c.body).batch).filter((e: { event: string }) => e.event === "$pageleave");
    await client.flush();
    const all = t.events().filter((e) => e.event === "$pageleave");
    expect(all).toHaveLength(1);
    expect(all[0]!.properties).toMatchObject({ $scroll_depth: 75, $scroll_depth_px: 1500 });
    expect(leaves.length).toBeLessThanOrEqual(1);
  });

  it("scroll depth resets per SPA route", async () => {
    set(document.documentElement, "scrollHeight", 1000);
    set(window, "innerHeight", 500);
    set(window, "scrollY", 500);
    const { client, t } = start({ autocapture: false });
    live = client;
    set(window, "scrollY", 0);
    history.pushState({}, "", "/next");
    window.dispatchEvent(new Event("pagehide"));
    await client.flush();
    const leaves = t.events().filter((e) => e.event === "$pageleave");
    expect(leaves[0]!.properties.$scroll_depth).toBe(100);
    expect(leaves[1]!.properties.$scroll_depth).toBe(50);
  });
});

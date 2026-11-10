import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { start, tick } from "./helpers.js";

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
    await tick(20);
    history.pushState({}, "", "/products");
    history.replaceState({}, "", "/products/1");
    history.pushState({}, "", "/products/1"); // same URL: nothing
    window.dispatchEvent(new PopStateEvent("popstate"));
    history.pushState({}, "", "/cart");
    await Promise.resolve(); // pageviews are captured a microtask after the route change
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

  it("hash mode: hashchange fires a pageview and $pathname carries the fragment route", async () => {
    const raw = history.pushState;
    history.replaceState({}, "", "/app#/inbox");
    const { client, t } = start({ autocapture: false, capturePageview: "hash" });
    live = client;
    await tick(20);
    raw.call(history, {}, "", "/app#/settings?tab=2"); // unpatched: only the hashchange below may fire
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.dispatchEvent(new HashChangeEvent("hashchange")); // same URL: nothing
    await Promise.resolve(); // pageviews are captured a microtask after the route change
    await client.flush();
    const views = t.events().filter((e) => e.event === "$pageview");
    expect(views.map((e) => e.properties.$pathname)).toEqual(["/app#/inbox", "/app#/settings"]);
  });

  it("history mode keeps $pathname without the fragment", async () => {
    history.replaceState({}, "", "/app#/inbox");
    const { client, t } = start({ autocapture: false });
    live = client;
    await client.flush();
    expect(t.events()[0]!.properties.$pathname).toBe("/app");
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

describe("pageview edge cases", () => {
  it("history mode ignores an in-page anchor; the object form picks the parts that count", async () => {
    const { client, t } = start({ autocapture: false });
    live = client;
    await tick(20);
    history.pushState({}, "", "/home#faq");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    history.pushState({}, "", "/home?tab=2");
    await Promise.resolve();
    await client.flush();
    expect(t.events().filter((e) => e.event === "$pageview")).toHaveLength(2);
    await client.shutdown();
    const only = start({ autocapture: false, capturePageview: { path: true } });
    live = only.client;
    await tick(20);
    history.pushState({}, "", "/home?tab=3");
    history.pushState({}, "", "/other?tab=3");
    await Promise.resolve();
    await only.client.flush();
    expect(only.t.events().filter((e) => e.event === "$pageview")).toHaveLength(2); // initial + /other
  });

  it("captures after the router's same-task title change, with how and from where it got there", async () => {
    document.title = "Home";
    const { client, t } = start({ autocapture: false });
    live = client;
    await tick(20);
    history.pushState({}, "", "/pricing");
    document.title = "Pricing"; // set right after pushState, like most routers
    await Promise.resolve();
    await client.flush();
    const views = t.events().filter((e) => e.event === "$pageview");
    expect(views[0]!.properties.$title).toBe("Home");
    expect(views[1]!.properties).toMatchObject({ $title: "Pricing", $navigation_type: "pushState", $prev_pageview_pathname: "/home" });
    expect(typeof views[1]!.properties.$prev_pageview_duration).toBe("number");
  });

  it("scrollRoot measures the app shell's inner scroller", async () => {
    document.body.innerHTML = '<div id="shell"></div>';
    const shell = document.getElementById("shell")!;
    set(shell, "scrollHeight", 2000);
    set(shell, "clientHeight", 500);
    set(shell, "scrollTop", 0);
    const { client, t } = start({ autocapture: false, scrollRoot: ["#missing", "#shell"] });
    live = client;
    set(shell, "scrollTop", 1000);
    shell.dispatchEvent(new Event("scroll")); // does not bubble: only the capture listener sees it
    window.dispatchEvent(new Event("pagehide"));
    await client.flush();
    expect(t.events().find((e) => e.event === "$pageleave")!.properties).toMatchObject({ $scroll_depth: 75, $scroll_depth_px: 1500 });
    document.body.innerHTML = "";
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChain, ignoreMatcher } from "../src/autocapture/chain.js";
import { rageHint, watchDeadClick } from "../src/autocapture/frustration.js";
import type { Host, Client } from "../src/index.js";
import { start, tick } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => history.replaceState({}, "", "/home"));
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
  vi.useRealTimers();
});

const click = (sel: string, init: MouseEventInit = {}) => document.querySelector(sel)!.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
const names = (t: ReturnType<typeof start>["t"]) => t.events().map((e) => e.event);

describe("autocapture element filters", () => {
  it("elementAllowlist limits capture to listed tags (or their descendants)", async () => {
    document.body.innerHTML = `<button id="b"><span id="in">x</span></button><a id="a" href="/x">l</a>`;
    const { client, t } = start({ capturePageview: false, autocapture: { elementAllowlist: ["button"] } });
    live = client;
    click("#a");
    click("#in");
    await client.flush();
    const ev = t.events().filter((e) => e.event === "$autocapture");
    expect(ev).toHaveLength(1);
    expect((ev[0]!.properties.$elements as Array<{ tag_name: string }>)[0]!.tag_name).toBe("span");
  });

  it("attributeIgnore drops named attributes, prefixes, href, id and class from the chain", () => {
    document.body.innerHTML = `<a id="go" class="btn" href="/x" title="t" aria-label="al" data-lc-track="c">Go</a>`;
    const el = document.getElementById("go")!;
    const full = buildChain(el, false, el)[0]!;
    expect(full).toMatchObject({ attr__id: "go", classes: ["btn"], href: "/x" });
    const cut = buildChain(el, false, el, ["title", "data-*", "href", "id", "class"])[0]!;
    expect(cut.attrs).toEqual({ "aria-label": "al" });
    expect(cut.href).toBeUndefined();
    expect(cut.attr__id).toBeUndefined();
    expect(cut.classes).toBeUndefined();
    expect(ignoreMatcher(["data-*"])("data-x")).toBe(true);
    expect(ignoreMatcher([])("data-x")).toBe(false);
  });
});

describe("frustration config", () => {
  const ck = (x: number, y: number) => ({ clientX: x, clientY: y }) as MouseEvent;

  it("count, radius and window are configurable", () => {
    const t = 5_000_000;
    const cfg = { count: 2, radiusPx: 5, windowMs: 300 };
    expect(rageHint(ck(0, 0), t, cfg)).toEqual({});
    expect(rageHint(ck(3, 3), t + 100, cfg)).toEqual({ $rageclick: true, $rageclick_count: 2 });
    expect(rageHint(ck(100, 100), t + 150, cfg)).toEqual({}); // too far
    expect(rageHint(ck(100, 100), t + 900, cfg)).toEqual({}); // window passed
  });

  it("ignoreSelectors and text selection suppress rage hints", () => {
    document.body.innerHTML = `<div class="skip"><b id="x">x</b></div>`;
    const t = 6_000_000;
    const cfg = { count: 1, ignoreSelectors: [".skip"] };
    expect(rageHint(ck(0, 0), t, cfg, document.getElementById("x")!)).toEqual({});
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "picked" } as Selection);
    expect(rageHint(ck(0, 0), t + 1, { count: 1 })).toEqual({});
    expect(rageHint(ck(0, 0), t + 2, { count: 1, ignoreTextSelection: false })).toEqual({ $rageclick: true, $rageclick_count: 1 });
    vi.restoreAllMocks();
  });

  it("rageClicks:false and the opt-out class add no hint on the click event", async () => {
    document.body.innerHTML = `<button id="b">b</button><button id="n" class="lc-no-rageclick">n</button>`;
    const off = start({ capturePageview: false, autocapture: { rageClicks: false } });
    live = off.client;
    for (let i = 0; i < 4; i++) click("#b", { clientX: 5, clientY: 5 });
    await off.client.flush();
    expect(off.t.events().some((e) => e.properties.$rageclick)).toBe(false);
    await off.client.shutdown();
    const on = start({ capturePageview: false, autocapture: { rageClicks: { count: 2 } } });
    live = on.client;
    click("#n", { clientX: 9, clientY: 9 });
    click("#n", { clientX: 9, clientY: 9 });
    await on.client.flush();
    expect(on.t.events().some((e) => e.properties.$rageclick)).toBe(false);
  });

  it("dead clicks: scroll or selection change counts as a reaction; deadClicks:false disables", async () => {
    vi.useFakeTimers();
    const capture = vi.fn();
    const host = { client: { capture }, onUnload: () => {} } as unknown as Host;
    watchDeadClick(host, "div#a", 100);
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(150);
    expect(capture).not.toHaveBeenCalled();
    watchDeadClick(host, "div#b", 100);
    document.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(150);
    expect(capture).not.toHaveBeenCalled();
    vi.useRealTimers();

    document.body.innerHTML = `<div id="d">plain</div>`;
    const { client, t } = start({ capturePageview: false, autocapture: { allowSelectors: ["#d"], deadClicks: false } });
    live = client;
    click("#d");
    await client.flush();
    expect(names(t)).toEqual(["$autocapture"]);
  });
});

describe("capturePageleave", () => {
  it("false: pageviews without pageleave", async () => {
    const { client, t } = start({ autocapture: false, capturePageleave: false });
    live = client;
    await tick(20);
    history.pushState({}, "", "/next");
    await Promise.resolve(); // pageviews are captured a microtask after the route change
    await client.flush();
    expect(names(t)).toEqual(["$pageview", "$pageview"]);
  });

  it("true with pageviews off: pageleave only", async () => {
    const { client, t } = start({ autocapture: false, capturePageview: false, capturePageleave: true });
    live = client;
    history.pushState({}, "", "/next");
    await client.flush();
    expect(names(t)).toEqual(["$pageleave"]);
  });

  it("default: nothing without pageviews", async () => {
    const { client, t } = start({ autocapture: false, capturePageview: false });
    live = client;
    history.pushState({}, "", "/next");
    await client.flush();
    expect(names(t)).toEqual([]);
  });
});

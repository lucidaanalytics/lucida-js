import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MASKED, attrProps, buildChain, isStepper, maskCopied } from "../src/autocapture/index.js";
import { rageHint } from "../src/autocapture/frustration.js";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => history.replaceState({}, "", "/home"));
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
  vi.restoreAllMocks();
});

const click = (sel: string, init: MouseEventInit = {}) => document.querySelector(sel)!.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
const auto = (t: ReturnType<typeof start>["t"]) => t.events().filter((e) => e.event === "$autocapture");

function selectText(node: Node): void {
  const r = document.createRange();
  r.selectNodeContents(node);
  const s = getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}

describe("URL ignorelist", () => {
  it("switches autocapture off on matching pages (string or RegExp), pageviews still count", async () => {
    document.body.innerHTML = `<button id="b">b</button>`;
    const { client, t } = start({ autocapture: { urlIgnorelist: ["/admin", /\/checkout\/\d+/] } });
    live = client;
    history.pushState({}, "", "/admin/users");
    click("#b");
    history.pushState({}, "", "/checkout/42");
    click("#b");
    history.pushState({}, "", "/shop");
    click("#b");
    await client.flush();
    expect(auto(t)).toHaveLength(1);
    expect(auto(t)[0]!.properties.$pathname).toBe("/shop");
    expect(t.events().filter((e) => e.event === "$pageview").length).toBeGreaterThan(0);
  });
});

describe("contenteditable", () => {
  it("reports an edited region once on blur, with the element chain and never the content", async () => {
    document.body.innerHTML = `<div id="ed" contenteditable="true" class="note">secret draft <b id="in">x</b></div><button id="out">o</button>`;
    const { client, t } = start({ capturePageview: false });
    live = client;
    const ed = document.getElementById("ed")!;
    document.getElementById("in")!.dispatchEvent(new Event("input", { bubbles: true }));
    ed.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.getElementById("in") }));
    expect(auto(t)).toHaveLength(0); // focus stayed inside the region
    ed.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    ed.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // no edit since: nothing more
    await client.flush();
    const ev = auto(t);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.properties).toMatchObject({ $event_type: "change", $el_contenteditable: true });
    expect(JSON.stringify(ev[0]!.properties)).not.toContain("secret");
    expect((ev[0]!.properties.$elements as Array<{ classes?: string[] }>)[0]!.classes).toEqual(["note"]);
  });

  it("contentEditable:false and ignored regions report nothing", async () => {
    document.body.innerHTML = `<div id="a" contenteditable>a</div><div data-lc-ignore><div id="b" contenteditable>b</div></div>`;
    const { client, t } = start({ capturePageview: false, autocapture: { contentEditable: false } });
    live = client;
    for (const id of ["a", "b"]) {
      const el = document.getElementById(id)!;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }
    await client.flush();
    expect(auto(t)).toHaveLength(0);
  });
});

describe("copy / cut", () => {
  it("off by default; copyCut sends $copy_autocapture with the type and no text", async () => {
    document.body.innerHTML = `<p id="p">Order 4111 1111 1111 1111 for a@b.co</p>`;
    const off = start({ capturePageview: false });
    selectText(document.getElementById("p")!);
    document.getElementById("p")!.dispatchEvent(new Event("copy", { bubbles: true }));
    await off.client.flush();
    expect(off.t.events()).toHaveLength(0);
    await off.client.shutdown();
    const on = start({ capturePageview: false, autocapture: { copyCut: true } });
    live = on.client;
    document.getElementById("p")!.dispatchEvent(new Event("cut", { bubbles: true }));
    await on.client.flush();
    const [ev] = on.t.events();
    expect(ev!.event).toBe("$copy_autocapture");
    expect(ev!.properties.$copy_type).toBe("cut");
    expect(ev!.properties.$selected_content).toBeUndefined();
    expect((ev!.properties.$elements as Array<{ tag_name: string }>)[0]!.tag_name).toBe("p");
  });

  it("captureCopiedText sends the selection masked; form controls and ignored areas send nothing", async () => {
    document.body.innerHTML = `<p id="p">Order 4111 1111 1111 1111 for a@b.co</p><input id="i" value="pw"><div data-lc-ignore><p id="q">hidden</p></div>`;
    const { client, t } = start({ capturePageview: false, autocapture: { copyCut: true, captureCopiedText: true } });
    live = client;
    selectText(document.getElementById("p")!);
    document.getElementById("p")!.dispatchEvent(new Event("copy", { bubbles: true }));
    getSelection()!.removeAllRanges();
    document.getElementById("i")!.dispatchEvent(new Event("copy", { bubbles: true }));
    selectText(document.getElementById("q")!);
    document.getElementById("q")!.dispatchEvent(new Event("copy", { bubbles: true }));
    await client.flush();
    expect(t.events()).toHaveLength(1);
    expect(t.events()[0]!.properties.$selected_content).toBe("Order *** for ***");
    expect(maskCopied("x".repeat(300))).toHaveLength(255);
  });
});

describe("data-lc-attr-* and attribute masking", () => {
  it("data-lc-attr-<name> on the target or an ancestor becomes an event property (nearest wins)", async () => {
    document.body.innerHTML = `<section data-lc-attr-plan="pro" data-lc-attr-slot="outer"><button id="b" data-lc-attr-slot="hero">Go</button></section>`;
    expect(attrProps(document.getElementById("b")!)).toEqual({ slot: "hero", plan: "pro" });
    const { client, t } = start({ capturePageview: false });
    live = client;
    click("#b");
    await client.flush();
    expect(auto(t)[0]!.properties).toMatchObject({ slot: "hero", plan: "pro" });
  });

  it("maskAllAttributes masks id, href and kept attributes except the allowlist", () => {
    document.body.innerHTML = `<a id="acct-991" href="/u/991" title="Jane" aria-label="profile" class="nav">x</a>`;
    const el = document.querySelector("a")!;
    const [m] = buildChain(el, false, el, undefined, { maskAll: true, allow: ["aria-*"] });
    expect(m).toMatchObject({ attr__id: MASKED, href: MASKED, classes: ["nav"] });
    expect(m!.attrs).toEqual({ title: MASKED, "aria-label": "profile" });
    expect(buildChain(el, false, el)[0]!.attr__id).toBe("acct-991");
  });

  it("the switch reaches $autocapture events", async () => {
    document.body.innerHTML = `<a id="secret-id" href="#x">x</a>`;
    const { client, t } = start({ capturePageview: false, autocapture: { maskAllAttributes: true, attributeAllowlist: ["href"] } });
    live = client;
    click("#secret-id");
    await client.flush();
    const [first] = auto(t)[0]!.properties.$elements as Array<{ attr__id?: string; href?: string }>;
    expect(first).toMatchObject({ attr__id: MASKED, href: "#x" });
  });
});

describe("stepper rage-click suppression", () => {
  const ck = (x: number, y: number) => ({ clientX: x, clientY: y }) as MouseEvent;

  it("recognises number inputs, +/- and arrow buttons, stepper/carousel classes and labels, and custom selectors", () => {
    document.body.innerHTML = `
      <input id="n" type="number">
      <button id="plus">+</button><button id="arrow">›</button>
      <div class="qty-control"><button id="q"><span id="qi">add</span></button></div>
      <button id="lbl" aria-label="Next slide">i</button>
      <div class="carousel"><button id="c">o</button></div>
      <button id="mine" class="my-step">s</button>
      <button id="buy">Buy now</button><button id="nextdoor" class="nextdoor">Shop</button>`;
    const el = (id: string) => document.getElementById(id)!;
    for (const id of ["n", "plus", "arrow", "q", "qi", "lbl", "c"]) expect(isStepper(el(id)), id).toBe(true);
    expect(isStepper(el("mine"))).toBe(false);
    expect(isStepper(el("mine"), [".my-step"])).toBe(true);
    expect(isStepper(el("buy"))).toBe(false);
    expect(isStepper(el("nextdoor"))).toBe(false);
  });

  it("repeated stepper clicks add no $rageclick unless suppressSteppers is false", () => {
    document.body.innerHTML = `<button id="plus">+</button>`;
    const plus = document.getElementById("plus")!;
    const t = 9_000_000;
    expect(rageHint(ck(1, 1), t, { count: 1 }, plus)).toEqual({});
    expect(rageHint(ck(1, 1), t + 1, { count: 1, suppressSteppers: false }, plus)).toMatchObject({ $rageclick: true });
  });

  it("end to end: hammering a quantity button is not a rage click", async () => {
    document.body.innerHTML = `<button id="plus" aria-label="Increase quantity">+</button><button id="buy">Buy</button>`;
    const { client, t } = start({ capturePageview: false, autocapture: { rageClicks: { count: 3 } } });
    live = client;
    for (let i = 0; i < 4; i++) click("#plus", { clientX: 5, clientY: 5 });
    for (let i = 0; i < 4; i++) click("#buy", { clientX: 50, clientY: 50 });
    await client.flush();
    const rage = auto(t).filter((e) => e.properties.$rageclick);
    expect(rage.length).toBeGreaterThan(0);
    expect(rage.every((e) => (e.properties.$elements as Array<{ attr__id?: string }>)[0]!.attr__id === "buy")).toBe(true);
  });
});

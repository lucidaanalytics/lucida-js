import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autocapture, cssSelector } from "../src/autocapture/index.js";
import { forms } from "../src/forms/index.js";
import { heatmaps, viewportBucket } from "../src/heatmaps/index.js";
import type { Client } from "../src/index.js";
import { startWith } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => history.replaceState({}, "", "/p"));
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
});

const click = (sel: string, init: MouseEventInit = { clientX: 40, clientY: 60 }) =>
  document.querySelector(sel)!.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));

// heatmaps turn on once remote config resolves; probe with clicks until one is captured, then discard the probe events
async function configured(c: Client, t: ReturnType<typeof startWith>["t"]): Promise<void> {
  const probe = document.createElement("i");
  probe.id = "lc-probe";
  document.body.append(probe);
  await vi.waitFor(async () => {
    click("#lc-probe");
    await c.flush();
    if (!t.events().some((e) => e.event === "$autocapture")) throw new Error("heatmaps not enabled yet");
  });
  probe.remove();
  t.calls.length = 0;
}

describe("click props (autocapture, for lc-signals)", () => {
  it("sends page-relative coordinates, selector and interactive flag in the shape lc-worker reads", async () => {
    document.body.innerHTML = `<div class="card wide extra"><button id="buy" class="btn">Buy</button></div>`;
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    const { client, t } = startWith([autocapture], { autocapture: {} });
    live = client;
    click("#buy");
    await client.flush();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    const p = t.events().find((e) => e.event === "$autocapture")!.properties;
    expect(p).toMatchObject({ $event_type: "click", $click_x: 40, $click_y: 560, $selector: "button#buy", $el_interactive: true });
  });
  it("selector uses only tag/#id/.class (the lc-replay subset) and stops at an id", () => {
    document.body.innerHTML = `<main id="app"><ul class="a b c"><li><a href="/x" class="go">x</a></li></ul></main>`;
    expect(cssSelector(document.querySelector("a")!)).toBe("main#app ul.a.b li a.go");
  });
});

describe("heatmaps", () => {
  it("decorates interactive clicks with element-relative offsets and captures non-interactive clicks as $el_interactive=false", async () => {
    document.body.innerHTML = `<button id="b">Go</button><div id="hero">Hero text with 4111 1111 1111 1111</div>`;
    const { client, t } = startWith([autocapture, heatmaps], { autocapture: {} });
    live = client;
    await configured(client, t);
    click("#b");
    click("#hero");
    await client.flush();
    const ev = t.events().filter((e) => e.event === "$autocapture");
    expect(ev).toHaveLength(2); // no duplicate for the interactive click
    expect(ev[0]!.properties).toMatchObject({ $el_interactive: true, $click_el_x: expect.any(Number), $viewport_bucket: viewportBucket(window.innerWidth) });
    expect(ev[1]!.properties).toMatchObject({ $el_interactive: false, $click_x: 40, $click_y: 60 });
    expect(JSON.stringify(ev[1])).not.toContain("4111"); // text of non-interactive targets is never captured
  });
  it("captures every click itself when autocapture is off, and honours data-lc-ignore", async () => {
    document.body.innerHTML = `<button id="b">Go</button><div data-lc-ignore><p id="ig">x</p></div>`;
    const { client, t } = startWith([heatmaps], { autocapture: false });
    live = client;
    await configured(client, t);
    click("#b");
    click("#ig");
    await client.flush();
    expect(t.events().filter((e) => e.event === "$autocapture")).toHaveLength(1);
  });
  it("moves are opt-in and batched as $heatmap_moves", async () => {
    const off = startWith([heatmaps], { autocapture: false });
    live = off.client;
    await configured(off.client, off.t);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 6 }));
    await off.client.flush();
    expect(off.t.events().some((e) => e.event === "$heatmap_moves")).toBe(false);
    await off.client.shutdown();

    const on = startWith([heatmaps], { autocapture: false, heatmaps: { moves: true, moveIntervalMs: 0 } });
    live = on.client;
    await configured(on.client, on.t);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 6, bubbles: true }));
    window.dispatchEvent(new Event("pagehide"));
    await on.client.flush();
    const m = on.t.events().find((e) => e.event === "$heatmap_moves")!;
    expect(m.properties.$points).toEqual([[5, 6, 0]]);
  });
  it("scroll depth in $pageleave carries px and percent", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
    const { client, t } = startWith([autocapture], { capturePageview: true, autocapture: false });
    live = client;
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("pagehide"));
    await client.flush();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    expect(t.events().find((e) => e.event === "$pageleave")!.properties).toMatchObject({ $scroll_depth: 50, $scroll_depth_px: 1000 });
  });
});

describe("forms", () => {
  const FORM = `<form id="signup" action="/signup"><label for="email">Email</label><input id="email" name="email" type="email">
    <input id="pw" name="password" type="password"><input id="n" name="note" aria-invalid="true"><button>Go</button></form>`;
  const focus = (id: string) => document.getElementById(id)!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  const blur = (id: string) => document.getElementById(id)!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

  it("emits start / field_interact / submit with hashed ids and never a value", async () => {
    document.body.innerHTML = FORM;
    const { client, t } = startWith([forms]);
    live = client;
    (document.getElementById("email") as HTMLInputElement).value = "me@secret.example";
    (document.getElementById("pw") as HTMLInputElement).value = "hunter2-form-secret";
    focus("email");
    blur("email");
    focus("email"); // refill
    blur("email");
    focus("pw");
    blur("pw");
    focus("n");
    blur("n");
    document.getElementById("signup")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await client.flush();
    const ev = t.events();
    expect(ev.map((e) => e.event)).toEqual(["$form_start", "$form_field_interact", "$form_field_interact", "$form_field_interact", "$form_field_interact", "$form_submit"]);
    const fields = ev.filter((e) => e.event === "$form_field_interact").map((e) => e.properties);
    expect(fields[0]).toMatchObject({ $field_type: "email", refill_count: 0, error: false });
    expect(fields[1]).toMatchObject({ refill_count: 1 });
    expect(fields[0]!.field).toMatch(/^[0-9a-f]{12}$/);
    expect(fields[0]!.field).toBe(fields[1]!.field);
    expect(fields[3]).toMatchObject({ error: true });
    expect(ev.find((e) => e.event === "$form_submit")!.properties).toMatchObject({ $fields_touched: 3 });
    const wire = JSON.stringify(ev);
    for (const secret of ["me@secret.example", "hunter2-form-secret", "Email"]) expect(wire).not.toContain(secret);
  });

  it("$form_abandon on pagehide names the last field; none after submit", async () => {
    document.body.innerHTML = FORM;
    const { client, t } = startWith([forms]);
    live = client;
    focus("email");
    blur("email");
    focus("n");
    window.dispatchEvent(new Event("pagehide"));
    await client.flush();
    const a = t.events().find((e) => e.event === "$form_abandon")!;
    expect(a.properties).toMatchObject({ $fields_touched: 2 });
    const id = t.events().filter((e) => e.event === "$form_field_interact")[0]!.properties.field;
    expect(a.properties.last_field).not.toBe(id); // last = the "note" field
    expect(a.properties.last_field).toMatch(/^[0-9a-f]{12}$/);
  });

  it("ignores [data-lc-ignore] forms", async () => {
    document.body.innerHTML = `<div data-lc-ignore>${FORM}</div>`;
    const { client, t } = startWith([forms]);
    live = client;
    focus("email");
    await client.flush();
    expect(t.events()).toHaveLength(0);
  });
});

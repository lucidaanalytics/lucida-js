import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flags } from "../src/flags/index.js";
import { guides } from "../src/guides/index.js";
import { applyChanges, changesOf, visualChanges } from "../src/experiments/index.js";
import { attentionTracker } from "../src/heatmaps/attention.js";
import { createEditor } from "../src/toolbar/editor.js";
import { resetArbiter, claim } from "../src/arbiter.js";
import type { Client, Guide } from "../src/index.js";
import { startWith, tick } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => {
  resetArbiter();
  localStorage.clear();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/app");
});
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
});

const guide = (over: Partial<Guide> = {}): Guide => ({
  id: "g1",
  name: "Welcome",
  kind: "tour",
  steps: [
    { id: "a", title: "Step A", selector: "#x", buttons: [{ label: "Next", action: "next" }, { label: "Skip", action: "dismiss" }] },
    { id: "b", title: "Step B", selector: "#y" },
  ],
  conditions: { url: "/app" },
  ...over,
});
const shadow = (): ShadowRoot => document.querySelector<HTMLElement>("[data-lc-ignore]")!.shadowRoot!;
const clickBtn = (label: string): void => [...shadow().querySelectorAll("button")].find((b) => b.textContent === label)!.click();

describe("guides module", () => {
  it("renders a tour from /v1/guides and emits shown/step/completed", async () => {
    document.body.innerHTML = `<button id="x">x</button><button id="y">y</button>`;
    const { client, t, f } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [guide()] } } } as never);
    live = client;
    await vi.waitFor(() => expect(shadow().textContent).toContain("Step A"));
    expect(f.calls.some((c) => c.url.startsWith("https://ingest.test/v1/guides?api_key=lc_pk_test"))).toBe(true);
    clickBtn("Next");
    expect(shadow().textContent).toContain("Step B");
    clickBtn("Done");
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
    await client.flush();
    const names = t.events().filter((e) => e.event.startsWith("$guide_")).map((e) => e.event);
    expect(names).toEqual(["$guide_shown", "$guide_step", "$guide_step", "$guide_completed"]);
    const steps = t.events().filter((e) => e.event === "$guide_step").map((e) => [e.properties.$guide_step_id, e.properties.$guide_step_index]);
    expect(steps).toEqual([["a", 0], ["b", 1]]);
  });

  it("dismiss emits $guide_dismissed and the guide is not shown again", async () => {
    document.body.innerHTML = `<button id="x">x</button>`;
    const { client, t } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [guide()] } } } as never);
    live = client;
    await vi.waitFor(() => expect(shadow().textContent).toContain("Step A"));
    clickBtn("Skip");
    await client.flush();
    expect(t.events().find((e) => e.event === "$guide_dismissed")!.properties).toMatchObject({ $guide_id: "g1", $guide_step_id: "a" });
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
  });

  it("targeting by url keeps the guide hidden", async () => {
    const { client, f } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [guide({ conditions: { url: "/other" } })] } } } as never);
    live = client;
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.includes("/v1/guides"))).toBe(true));
    await tick(10);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
  });

  it("modal traps focus (Tab wraps, Escape dismisses) and renders text safely", async () => {
    const g = guide({ kind: "modal", steps: [{ id: "m", title: "<img src=x onerror=alert(1)>", body: "Hi", buttons: [{ label: "OK", action: "next" }, { label: "No", action: "dismiss" }] }] });
    const { client } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [g] } } } as never);
    live = client;
    await vi.waitFor(() => expect(shadow().querySelector("[role=dialog]")).toBeTruthy());
    const box = shadow().querySelector<HTMLElement>("[role=dialog]")!;
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(shadow().querySelector("img")).toBeNull();
    const [ok, no] = [...box.querySelectorAll("button")];
    no!.focus();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(shadow().activeElement).toBe(ok);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
  });

  it("checklist emits a step per ticked item then completes", async () => {
    const g = guide({ kind: "checklist", steps: [{ id: "i1", title: "One" }, { id: "i2", title: "Two" }] });
    const { client, t } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [g] } } } as never);
    live = client;
    await vi.waitFor(() => expect(shadow().textContent).toContain("One"));
    clickBtn("One");
    clickBtn("Two");
    await client.flush();
    expect(t.events().filter((e) => e.event.startsWith("$guide_")).map((e) => e.event)).toEqual(["$guide_shown", "$guide_step", "$guide_step", "$guide_completed"]);
  });

  it("arbiter: a guide never shows while another engagement holds the screen", async () => {
    const release = claim()!;
    const { client, f } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [guide()] } } } as never);
    live = client;
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.includes("/v1/guides"))).toBe(true));
    await tick(10);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
    release();
  });
});

describe("visual editor changes", () => {
  it("applies text, attr, style, hide and reorder", () => {
    document.body.innerHTML = `<ul id="l"><li id="a">A</li><li id="b">B</li><li id="c">C</li></ul><a id="lnk" href="/x" onclick="1">go</a>`;
    const missing = applyChanges([
      { selector: "#a", type: "text", value: "Alpha" },
      { selector: "#lnk", type: "attr", name: "href", value: "/y" },
      { selector: "#lnk", type: "attr", name: "onclick", value: "evil()" },
      { selector: "#lnk", type: "attr", name: "href", value: "javascript:evil()" },
      { selector: "#b", type: "style", styles: { color: "red" } },
      { selector: "#c", type: "hide" },
      { selector: "#c", type: "reorder", index: 0 },
      { selector: "#nope", type: "hide" },
    ]);
    expect(document.getElementById("a")!.textContent).toBe("Alpha");
    expect(document.getElementById("lnk")!.getAttribute("href")).toBe("/y");
    expect(document.getElementById("lnk")!.getAttribute("onclick")).toBe("1");
    expect(document.getElementById("b")!.style.color).toBe("red");
    expect(document.getElementById("c")!.style.display).toBe("none");
    expect([...document.querySelectorAll("#l li")].map((e) => e.id)).toEqual(["c", "a", "b"]);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.selector).toBe("#nope");
  });

  it("is idempotent and skips invalid selectors", () => {
    document.body.innerHTML = `<p id="p">x</p>`;
    const c = [{ selector: "#p", type: "text" as const, value: "y" }, { selector: "###", type: "hide" as const }];
    applyChanges(c);
    applyChanges(c);
    expect(document.getElementById("p")!.textContent).toBe("y");
  });

  it("changesOf reads lc_changes from a payload and ignores junk", () => {
    expect(changesOf({ lc_changes: [{ selector: "#a", type: "hide" }, 3, null] })).toHaveLength(1);
    expect(changesOf(undefined)).toEqual([]);
    expect(changesOf({ lc_changes: "x" })).toEqual([]);
  });

  it("module applies the assigned variant's changes and records the exposure; personalization is the same", async () => {
    document.body.innerHTML = `<h1 id="h">Old</h1>`;
    const resp = {
      flags: {
        exp: { variant: "b", value: "b", payload: { lc_changes: [{ selector: "#h", type: "text", value: "New" }] } },
        persona: { enabled: true, value: true, payload: { lc_changes: [{ selector: "#h", type: "style", styles: { color: "blue" } }] } },
      },
    };
    const { client, t } = startWith([flags, visualChanges], { _h: { "/v1/flags": resp }, visualChanges: { antiFlickerMs: 50 } } as never);
    live = client;
    expect(document.head.querySelector("style")?.textContent).toContain("opacity:0");
    await vi.waitFor(() => {
      expect(document.getElementById("h")!.textContent).toBe("New");
      expect(document.getElementById("h")!.style.color).toBe("blue");
    });
    expect(document.head.querySelector("style")).toBeNull(); // veil lifted once applied
    await client.flush();
    expect(t.events().some((e) => e.event === "$exposure" && e.properties.$feature_flag === "exp")).toBe(true);
  });

  it("anti-flicker veil lifts at the timeout when flags never arrive", async () => {
    const { client } = startWith([visualChanges], { visualChanges: { antiFlickerMs: 20 } });
    live = client;
    expect(document.head.querySelector("style")).not.toBeNull();
    await vi.waitFor(() => expect(document.head.querySelector("style")).toBeNull());
  });

  it("late-rendered elements get their changes via the mutation observer", async () => {
    const resp = { flags: { exp: { value: "b", payload: { lc_changes: [{ selector: "#late", type: "text", value: "Done" }] } } } };
    const { client, f } = startWith([flags, visualChanges], { _h: { "/v1/flags": resp } } as never);
    live = client;
    await vi.waitFor(() => expect(client.getFlag("exp")).toBe("b")); // flags (and the observer) are in place
    expect(f.calls.some((c) => c.url.includes("/v1/flags"))).toBe(true);
    document.body.innerHTML = `<p id="late">x</p>`;
    await vi.waitFor(() => expect(document.getElementById("late")!.textContent).toBe("Done"));
  });

  it("toolbar editor records one change per target and exports the payload", () => {
    document.body.innerHTML = `<div id="w"><p id="p">x</p><p id="q">y</p></div>`;
    const ed = createEditor();
    const p = document.getElementById("p")!;
    ed.text(p, "one");
    ed.text(p, "two");
    ed.style(p, "color", "red");
    ed.style(p, "margin", "0");
    ed.move(p, 1);
    ed.hide(document.getElementById("q")!);
    expect(p.textContent).toBe("two");
    expect(ed.changes()).toHaveLength(4);
    expect(ed.changes().find((c) => c.type === "style")).toMatchObject({ styles: { color: "red", margin: "0" } });
    expect(JSON.parse(JSON.stringify(ed.toPayload())).lc_changes).toHaveLength(4);
    expect(ed.changes().find((c) => c.type === "reorder")).toMatchObject({ index: 1 });
  });
});

describe("attention tracker", () => {
  it("credits viewport bands and element time, ignores hidden tabs, drains", () => {
    let now = 0;
    let y = 0;
    let vis = true;
    const tr = attentionTracker({ now: () => now, scrollY: () => y, viewportH: () => 500, pageH: () => 2000, visible: () => vis });
    now = 1000;
    tr.tick(); // viewport 0..500 of 2000: bands 0,1,2 (0-200,200-400,400-600)
    tr.enter("h2.a");
    y = 1000;
    now = 3000;
    tr.tick(); // 1000..1500: bands 5,6,7
    vis = false;
    now = 4000;
    tr.tick(); // hidden: nothing
    tr.leave("h2.a"); // hidden at leave: not credited
    vis = true;
    now = 4500;
    tr.enter("h1");
    now = 5500;
    const b = tr.drain();
    expect(b.bands).toEqual([[0, 1000], [1, 1000], [2, 1000], [5, 2000], [6, 2000], [7, 2000]]);
    expect(b.elements).toEqual([["h1", 1000]]);
    expect(tr.drain()).toEqual({ bands: [], elements: [] }); // reset (h1 still open but nothing elapsed)
  });
});

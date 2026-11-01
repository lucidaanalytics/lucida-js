import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flags } from "../src/flags/index.js";
import { parsePreview } from "../src/flags/preview.js";
import { changesOf, visualChanges } from "../src/experiments/index.js";
import { guides } from "../src/guides/index.js";
import { mediaEl } from "../src/guides/render.js";
import { listed, searchHref } from "../src/guides/modules.js";
import { withChanges } from "../src/toolbar/experiment-editor.js";
import { createEditor } from "../src/toolbar/editor.js";
import { resetArbiter } from "../src/arbiter.js";
import type { Client, Guide } from "../src/index.js";
import { startWith } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => {
  resetArbiter();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/app");
});
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

const g = (over: Partial<Guide>): Guide => ({ id: "g1", name: "G", kind: "modal", steps: [{ id: "a", title: "Hi" }], conditions: {}, ...over });
const shadowOf = (i = 0): ShadowRoot => [...document.querySelectorAll<HTMLElement>("[data-lc-ignore]")].filter((e) => e.shadowRoot)[i]!.shadowRoot!;

describe("multipage changes and QA preview (LC-EXT-33, 34)", () => {
  it("scopes changes to their page", () => {
    const p = { lc_changes: [{ selector: "h1", type: "hide" }, { selector: "h2", type: "hide", url: "/pricing" }] };
    expect(changesOf(p, "https://x.test/app")).toHaveLength(1);
    expect(changesOf(p, "https://x.test/pricing?a=1")).toHaveLength(2);
    expect(changesOf(p)).toHaveLength(2);
  });

  it("asks the gateway for the previewed variant and records no exposure", async () => {
    history.replaceState({}, "", "/app?lc_preview=hero:big");
    expect(parsePreview("a:b,bad,:x,c:d")).toEqual({ a: "b", c: "d" });
    document.body.innerHTML = `<h1 id="h">Old</h1>`;
    const r = startWith([flags, visualChanges], {
      _h: { "/v1/flags": { flags: { hero: { variant: "big", value: "big", payload: { lc_changes: [{ selector: "#h", type: "text", value: "New" }] } } } } },
    } as never);
    live = r.client;
    await vi.waitFor(() => expect(document.getElementById("h")!.textContent).toBe("New"));
    const body = JSON.parse(String(r.f.calls.find((c) => c.url.endsWith("/v1/flags"))!.init!.body)) as { preview?: Record<string, string> };
    expect(body.preview).toEqual({ hero: "big" });
    await r.client.flush();
    expect(r.t.events().some((e) => e.event === "$exposure")).toBe(false);
    expect(sessionStorage.getItem("lc_preview")).toBe("hero:big");
  });
});

describe("layer parameters (LC-EXT-36)", () => {
  it("reads a parameter from the layer experiment the person is in, else the fallback", async () => {
    const r = startWith([flags], {
      _h: { "/v1/flags": { flags: { exp1: { variant: "b", value: "b", payload: { lc_layer: "checkout", lc_params: { color: "green" } } } } } },
    } as never);
    live = r.client;
    await vi.waitFor(() => expect(r.client.getLayerParam("checkout", "color", "red")).toBe("green"));
    expect(r.client.getLayerParam("checkout", "size", 1)).toBe(1);
    expect(r.client.getLayerParam("other", "color", "red")).toBe("red");
  });
});

describe("visual editor recorder (LC-EXT-37)", () => {
  it("keeps the saved list, scopes edits to this page and replaces one variant's changes", () => {
    document.body.innerHTML = `<p id="p">x</p>`;
    let only = false;
    const ed = createEditor([{ selector: "h1", type: "hide" }], () => only);
    only = true;
    ed.text(document.getElementById("p")!, "y");
    expect(ed.changes()).toHaveLength(2);
    expect(ed.changes()[1]).toMatchObject({ type: "text", url: "/app" });
    ed.remove(0);
    expect(ed.changes()).toHaveLength(1);
    const exp = { id: "e", name: "E", status: "draft", variants: [{ key: "control", allocation_pct: 50 }, { key: "b", allocation_pct: 50, payload: { other: 1 } }] };
    expect(withChanges(exp, "b", [...ed.changes()])[1]!.payload).toEqual({ other: 1, lc_changes: [...ed.changes()] });
  });
});

describe("guide kinds, media and resource-center modules (LC-ENG-17, 19, 20)", () => {
  it("renders media safely", () => {
    expect(mediaEl({ type: "image", url: "https://cdn.test/a.png", alt: "A" })?.getAttribute("alt")).toBe("A");
    expect(mediaEl({ type: "image", url: "javascript:alert(1)" })).toBeNull();
    expect(mediaEl({ type: "embed", url: "https://evil.test/x" })).toBeNull();
    expect(mediaEl({ type: "embed", url: "https://player.vimeo.com/video/1", alt: "Demo" })?.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("shows a slideout with tokens and an inline guide after its element", async () => {
    document.body.innerHTML = `<div id="slot"></div><footer>end</footer>`;
    const list = [
      g({ id: "s", kind: "slideout", appearance: { side: "left", tokens: { background: "#112233", radius: 4 } }, steps: [{ id: "a", title: "News", media: [{ type: "image", url: "https://cdn.test/a.png", alt: "Shot" }] }] }),
      g({ id: "i", kind: "inline", steps: [{ id: "a", title: "Tip", selector: "#slot" }] }),
    ];
    live = startWith([flags, guides], { _h: { "/v1/guides": { guides: list } } } as never).client;
    await vi.waitFor(() => expect(document.querySelectorAll("[data-lc-ignore]").length).toBe(2));
    const hosts = [...document.querySelectorAll<HTMLElement>("[data-lc-ignore]")];
    const inline = hosts.find((h) => h.previousElementSibling?.id === "slot")!;
    expect(inline.shadowRoot!.querySelector(".in")?.getAttribute("role")).toBe("region");
    const so = hosts.find((h) => h !== inline)!.shadowRoot!.querySelector<HTMLElement>(".so.sl")!;
    expect(so.style.borderRadius).toBe("4px");
    expect(so.querySelector("img")?.alt).toBe("Shot");
  });

  it("lists guides in a resource center and opens one", async () => {
    const tour = g({ id: "t1", name: "Billing tour", kind: "tour", conditions: { url: "/never" }, steps: [{ id: "a", title: "Start", selector: "body" }] });
    const rc = g({ id: "rc", kind: "resource_center", steps: [{ id: "m", title: "Tours", module: "guides" }, { id: "s", title: "Docs", module: "search", search_url: "https://docs.test/?q={q}" }] });
    expect(listed(rc.steps[0]!, [tour, rc])).toEqual([tour]);
    expect(searchHref(rc.steps[1]!, "a b")).toBe("https://docs.test/?q=a%20b");
    live = startWith([flags, guides], { _h: { "/v1/guides": { guides: [tour, rc] } } } as never).client;
    const open = await vi.waitFor(() => [...shadowOf().querySelectorAll("button")].find((b) => b.textContent === "Billing tour")!);
    open.click();
    await vi.waitFor(() => expect(shadowOf().querySelector("h2")?.textContent).toBe("Start"));
  });

  it("previews a QA draft without targeting or events", async () => {
    const r = startWith([flags, guides], { _h: { "/v1/guides": { guides: [g({ preview: true, conditions: { url: "/elsewhere" } })] } } } as never);
    live = r.client;
    await vi.waitFor(() => expect(shadowOf().querySelector("h2")?.textContent).toBe("Hi"));
    await r.client.flush();
    expect(r.t.events().filter((e) => e.event.startsWith("$guide_"))).toEqual([]);
  });
});

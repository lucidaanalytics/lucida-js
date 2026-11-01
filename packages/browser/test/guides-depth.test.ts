import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flags } from "../src/flags/index.js";
import { guides } from "../src/guides/index.js";
import { defaultButtons, renderGuide, type GuideHooks } from "../src/guides/render.js";
import { resetArbiter } from "../src/arbiter.js";
import { eligible } from "../src/targeting.js";
import type { Client, Guide } from "../src/index.js";
import { startWith, tick } from "./helpers.js";

let live: Client | undefined;
let stop: (() => void) | undefined;
beforeEach(() => {
  resetArbiter();
  localStorage.clear();
  document.body.innerHTML = "";
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
  await live?.shutdown();
});

const guide = (over: Partial<Guide> = {}): Guide => ({ id: "g1", name: "Tour", kind: "tour", steps: [], conditions: {}, ...over });
const hooks = (): GuideHooks & { log: string[] } => {
  const log: string[] = [];
  return { log, shown: () => log.push("shown"), step: (i) => log.push(`step:${i}`), completed: () => log.push("completed"), dismissed: () => log.push("dismissed"), event: () => {} };
};
const shadow = (): ShadowRoot => document.querySelector<HTMLElement>("[data-lc-ignore]")!.shadowRoot!;
const box = (): HTMLElement => shadow().querySelector<HTMLElement>(".g")!;
const labels = (): string[] => [...box().querySelectorAll("button")].map((b) => b.textContent ?? "");
const click = (label: string): void => [...box().querySelectorAll("button")].find((b) => b.textContent === label)!.click();
const target = (id: string): HTMLElement => {
  const e = Object.assign(document.createElement("button"), { id });
  document.body.append(e);
  return e;
};

describe("guide step navigation", () => {
  it("Back returns along the visited path, including across a goto", () => {
    const h = hooks();
    const g = guide({ kind: "modal", steps: [{ id: "a", title: "A", buttons: [{ label: "Skip", action: "next", goto: "c" }] }, { id: "b", title: "B" }, { id: "c", title: "C" }] });
    stop = renderGuide(g, h, () => {});
    expect(labels()).toEqual(["Skip"]);
    click("Skip");
    expect(box().getAttribute("aria-label")).toBe("C");
    expect(labels()).toEqual(["Back", "Done", "Dismiss"]);
    click("Back");
    expect(box().getAttribute("aria-label")).toBe("A"); // b was never visited
  });

  it("a click-advance step moves on when its target is clicked, with no Next button", () => {
    const h = hooks();
    const btn = target("save");
    stop = renderGuide(guide({ steps: [{ id: "a", title: "A", selector: "#save", advance: "click" }, { id: "b", title: "B" }] }), h, () => {});
    expect(labels()).toEqual(["Dismiss"]);
    btn.click();
    expect(box().getAttribute("aria-label")).toBe("B");
    btn.click(); // the listener is gone after the step changed
    expect(h.log.filter((x) => x === "completed")).toHaveLength(0);
  });

  it("falls back to the next selector and skips invalid ones", () => {
    target("alt");
    stop = renderGuide(guide({ steps: [{ id: "a", title: "A", selector: "#missing", fallback_selectors: ["[[bad", "#alt"] }] }), hooks(), () => {});
    expect(box().style.visibility).toBe("");
    expect(box().classList.contains("p")).toBe(false); // anchored, not the corner fallback
  });

  it("waits for a late target, then shows unanchored once the wait runs out", () => {
    vi.useFakeTimers();
    stop = renderGuide(guide({ steps: [{ id: "a", title: "A", selector: "#late", wait_ms: 1000 }] }), hooks(), () => {});
    expect(box().style.visibility).toBe("hidden");
    target("late");
    vi.advanceTimersByTime(200);
    expect(box().style.visibility).toBe("");
    expect(box().classList.contains("p")).toBe(false);
    stop();
    document.body.innerHTML = "";
    stop = renderGuide(guide({ steps: [{ id: "a", title: "A", selector: "#never", wait_ms: 1000 }] }), hooks(), () => {});
    vi.advanceTimersByTime(900);
    expect(box().style.visibility).toBe("hidden");
    vi.advanceTimersByTime(300);
    expect(box().style.visibility).toBe("");
  });

  it("default buttons", () => {
    expect(defaultButtons("tour", false, false, true).map((b) => b.action)).toEqual(["back", "dismiss"]);
    expect(defaultButtons("banner", false, false).map((b) => b.action)).toEqual(["dismiss"]);
  });
});

describe("guide styling toggles", () => {
  it("an overlay on any kind, and outside-click dismiss without one", async () => {
    vi.useFakeTimers();
    const h = hooks();
    stop = renderGuide(guide({ kind: "tooltip", steps: [{ id: "a", title: "A" }], appearance: { overlay: true, dismiss_on_outside_click: true } }), h, () => {});
    shadow().querySelector<HTMLElement>(".o")!.click();
    expect(h.log).toContain("dismissed");
    const h2 = hooks();
    stop = renderGuide(guide({ kind: "slideout", steps: [{ id: "a", title: "A" }], appearance: { dismiss_on_outside_click: true } }), h2, () => {});
    expect(shadow().querySelector(".o")).toBeNull();
    vi.advanceTimersByTime(1);
    box().querySelector("h2")!.click(); // inside: stays
    expect(h2.log).not.toContain("dismissed");
    document.body.click();
    expect(h2.log).toContain("dismissed");
  });

  it("a modal can opt out of outside-click dismiss", () => {
    const h = hooks();
    stop = renderGuide(guide({ kind: "modal", steps: [{ id: "a", title: "A" }], appearance: { dismiss_on_outside_click: false } }), h, () => {});
    shadow().querySelector<HTMLElement>(".o")!.click();
    expect(h.log).not.toContain("dismissed");
  });

  it("font, shadow, button radius and secondary tokens; unsafe values are ignored", () => {
    const tokens = { font: "Inter, sans-serif", shadow: "lg" as const, button_radius: 12, secondary: "#eeeeee", secondary_text: "#123" };
    stop = renderGuide(guide({ kind: "modal", steps: [{ id: "a", title: "A" }], appearance: { tokens } }), hooks(), () => {});
    expect(box().style.fontFamily).toContain("Inter");
    expect(box().style.boxShadow).toContain("32px");
    expect(box().style.getPropertyValue("--br")).toBe("12px");
    expect(box().style.getPropertyValue("--s")).toBe("#eeeeee");
    stop();
    document.body.innerHTML = "";
    stop = renderGuide(guide({ kind: "modal", steps: [{ id: "a", title: "A" }], appearance: { tokens: { font: "x;}body{display:none", button_radius: 99 } } }), hooks(), () => {});
    expect(box().style.fontFamily).toBe("");
    expect(box().style.getPropertyValue("--br")).toBe("");
  });
});

describe("guide control", () => {
  it("flag variant targeting", () => {
    const ctx = { url: "https://x.test/", flags: () => true, lastShownMs: undefined, nowMs: 0, random: () => 0 };
    const c = { flag_key: "checkout", flag_variant: "b" };
    expect(eligible({ conditions: c }, { ...ctx, flagValue: () => "b" })).toBe(true);
    expect(eligible({ conditions: c }, { ...ctx, flagValue: () => "a" })).toBe(false);
  });

  it("show(id) ignores targeting; reset(id) lets a seen guide show again", async () => {
    const g = guide({ id: "g9", kind: "modal", steps: [{ id: "a", title: "Hi" }], conditions: { url: "/never" } });
    const r = startWith([flags, guides], { persistence: "localStorage", _h: { "/v1/guides": { guides: [g] } } } as never);
    live = r.client;
    await tick(20);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
    expect(live.guides.show("nope")).toBe(false);
    expect(live.guides.show("g9")).toBe(true);
    expect(live.guides.show("g9")).toBe(false); // already open
    click("Dismiss");
    live.guides.reset("g9");
    expect(live.guides.show("g9")).toBe(true);
  });
});

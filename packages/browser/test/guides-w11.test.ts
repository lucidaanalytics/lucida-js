import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flags } from "../src/flags/index.js";
import { guides } from "../src/guides/index.js";
import { renderGuide, type GuideHooks } from "../src/guides/render.js";
import { branchOk, runAutomation, sensitive } from "../src/guides/step-extras.js";
import { failedRule, renderValidation } from "../src/guides/validation.js";
import { resolveTokens, wantsDark } from "../src/guides/theme.js";
import { listenFrames, FRAME_MSG } from "../src/guides/frame.js";
import { renderModule, resetAssist, type Assist } from "../src/guides/modules.js";
import { resetArbiter } from "../src/arbiter.js";
import type { Client, Guide, GuideRule } from "../src/index.js";
import { startWith, tick } from "./helpers.js";

const SUFFIX = "__pk_test"; // storage keys are namespaced per project key (lc_pk_test)
let live: Client | undefined;
let stop: (() => void) | undefined;
beforeEach(() => {
  resetArbiter();
  resetAssist();
  localStorage.clear();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/app");
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

const guide = (over: Partial<Guide> = {}): Guide => ({ id: "g1", name: "G", kind: "modal", steps: [], conditions: {}, ...over });
const hooks = (): GuideHooks & { log: string[] } => {
  const log: string[] = [];
  return {
    log,
    shown: () => log.push("shown"),
    step: (i) => log.push(`step:${i}`),
    completed: () => log.push("completed"),
    dismissed: (_i, _id, reason) => log.push(`dismissed${reason ? `:${reason}` : ""}`),
    event: () => {},
    snoozed: (id, h) => log.push(`snoozed:${id}:${h}`),
    targetMissing: (id, sel) => log.push(`missing:${id}:${sel}`),
    validationFailed: (id, rule) => log.push(`invalid:${id}:${rule}`),
    automated: (id, r) => log.push(`auto:${id}:${r}`),
  };
};
const shadow = (): ShadowRoot => document.querySelector<HTMLElement>("[data-lc-ignore]")!.shadowRoot!;
const box = (): HTMLElement => shadow().querySelector<HTMLElement>(".g")!;
const click = (label: string): void => [...box().querySelectorAll("button")].find((b) => b.textContent === label)!.click();

describe("carousel", () => {
  it("pages with dots, Next / Back and arrow keys, then completes", () => {
    const h = hooks();
    stop = renderGuide(guide({ kind: "carousel", steps: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }] }), h, () => {});
    expect(box().getAttribute("aria-roledescription")).toBe("carousel");
    expect(box().querySelectorAll(".cd button")).toHaveLength(3);
    click("Next");
    expect(box().getAttribute("aria-label")).toBe("B");
    box().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(box().getAttribute("aria-label")).toBe("C");
    box().querySelector<HTMLButtonElement>(".cd button")!.click(); // first dot
    expect(box().getAttribute("aria-label")).toBe("A");
    click("Next");
    click("Next");
    click("Done");
    expect(h.log).toContain("completed");
  });
});

describe("step behaviour extras", () => {
  it("snooze reports its hours and dismisses with reason snooze", () => {
    const h = hooks();
    stop = renderGuide(guide({ steps: [{ id: "a", title: "A", buttons: [{ label: "Later", action: "snooze", snooze_hours: 2 }] }] }), h, () => {});
    click("Later");
    expect(h.log).toEqual(["shown", "step:0", "snoozed:a:2", "dismissed:snooze"]);
  });

  it("auto_close_s dismisses with reason auto_close", () => {
    vi.useFakeTimers();
    const h = hooks();
    stop = renderGuide(guide({ steps: [{ id: "a", title: "A", auto_close_s: 5 }] }), h, () => {});
    vi.advanceTimersByTime(4900);
    expect(h.log).not.toContain("dismissed:auto_close");
    vi.advanceTimersByTime(200);
    expect(h.log).toContain("dismissed:auto_close");
  });

  it("advance input moves on when the target field changes, without a Next button", () => {
    const field = Object.assign(document.createElement("input"), { id: "email" });
    document.body.append(field);
    stop = renderGuide(guide({ kind: "tour", steps: [{ id: "a", title: "A", selector: "#email", advance: "input" }, { id: "b", title: "B" }] }), hooks(), () => {});
    expect([...box().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Dismiss"]);
    field.dispatchEvent(new Event("change"));
    expect(box().getAttribute("aria-label")).toBe("B");
  });

  it("emits target missing when an anchored step times out", () => {
    vi.useFakeTimers();
    const h = hooks();
    stop = renderGuide(guide({ kind: "tooltip", steps: [{ id: "a", title: "A", selector: "#nope", wait_ms: 300 }] }), h, () => {});
    vi.advanceTimersByTime(500);
    expect(h.log).toContain("missing:a:#nope");
    expect(box().style.visibility).toBe("");
  });

  it("branches on element presence and on flags", () => {
    document.body.innerHTML = `<div id="pro"></div>`;
    expect(branchOk({ key: "", op: "element_present", value: "#pro", goto: "x" }, {})).toBe(true);
    expect(branchOk({ key: "", op: "element_absent", value: "#pro", goto: "x" }, {})).toBe(false);
    expect(branchOk({ key: "", op: "element_present", value: "[[bad", goto: "x" }, {})).toBe(false);
    expect(branchOk({ key: "", op: "flag_on", value: "beta", goto: "x" }, { flag: (k) => k === "beta" })).toBe(true);
    expect(branchOk({ key: "", op: "flag_off", value: "beta", goto: "x" }, { flag: () => false })).toBe(true);
    expect(branchOk({ key: "plan", op: "eq", value: "pro", goto: "x" }, { person: { plan: "pro" } })).toBe(true);
    const h = hooks();
    stop = renderGuide(guide({ steps: [{ id: "a", title: "A", branch: [{ key: "", op: "element_present", value: "#pro", goto: "c" }] }, { id: "b", title: "B" }, { id: "c", title: "C" }] }), h, () => {});
    click("Next");
    expect(box().getAttribute("aria-label")).toBe("C");
  });

  it("automation clicks, focuses and fills, and refuses sensitive fields", () => {
    document.body.innerHTML = `<button id="go"></button><input id="name"><input id="pw" type="password"><div data-lc-mask><input id="m"></div><input id="cc" autocomplete="cc-number">`;
    let clicked = 0;
    document.getElementById("go")!.onclick = () => clicked++;
    expect(runAutomation({ action: "click", selector: "#go" })).toBe("done");
    expect(clicked).toBe(1);
    const changes: string[] = [];
    document.getElementById("name")!.addEventListener("change", () => changes.push("change"));
    expect(runAutomation({ action: "fill", selector: "#name", value: "Acme" })).toBe("done");
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("Acme");
    expect(changes).toEqual(["change"]);
    for (const id of ["pw", "m", "cc"]) {
      expect(sensitive(document.getElementById(id)!)).toBe(true);
      expect(runAutomation({ action: "fill", selector: `#${id}`, value: "x" })).toBe("refused");
    }
    expect(runAutomation({ action: "fill", selector: "#name" })).toBe("refused"); // no constant
    expect(runAutomation({ action: "focus", selector: "#missing" })).toBe("missing");
    expect(runAutomation({ action: "click", selector: "[[" })).toBe("invalid");
  });
});

describe("form validation", () => {
  const rules = (type: GuideRule["type"], value?: string | number): GuideRule[] => [{ type, message: "bad", ...(value !== undefined ? { value } : {}) }];
  it("checks formats; empty optional fields pass", () => {
    expect(failedRule("", rules("required"))?.type).toBe("required");
    expect(failedRule("", rules("email"))).toBeNull();
    expect(failedRule("a@b", rules("email"))?.type).toBe("email");
    expect(failedRule("a@b.co", rules("email"))).toBeNull();
    expect(failedRule("ftp://x", rules("url"))?.type).toBe("url");
    expect(failedRule("+1 (555) 010-9999", rules("phone"))).toBeNull();
    expect(failedRule("12", rules("phone"))?.type).toBe("phone");
    expect(failedRule("abc", rules("regex", "^\\d+$"))?.type).toBe("regex");
    expect(failedRule("abc", rules("regex", "(("))).toBeNull(); // broken pattern never blocks
    expect(failedRule("ab", rules("min_length", 3))?.type).toBe("min_length");
    expect(failedRule("abcd", rules("max_length", 3))?.type).toBe("max_length");
    expect(failedRule("1e3", rules("number"))).toBeNull();
    expect(failedRule("x1", rules("number"))?.type).toBe("number");
  });

  it("shows the message on blur, blocks a bad submit and reports only the rule", () => {
    document.body.innerHTML = `<form id="f"><input id="email" value="nope"></form>`;
    const h = hooks();
    stop = renderValidation(guide({ kind: "form_validation", steps: [{ id: "s1", validation: { selector: "#email", rules: [{ type: "email", message: "Enter an email" }] } }] }), h, () => {});
    const field = document.getElementById("email") as HTMLInputElement;
    field.dispatchEvent(new Event("blur"));
    expect(shadow().querySelector(".v")?.textContent).toBe("Enter an email");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const submit = new Event("submit", { cancelable: true, bubbles: true });
    document.getElementById("f")!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(h.log.filter((x) => x.startsWith("invalid"))).toEqual(["invalid:s1:email", "invalid:s1:email"]);
    expect(h.log.join()).not.toContain("nope");
    field.value = "a@b.co";
    field.dispatchEvent(new Event("blur"));
    expect(shadow().querySelector(".v")).toBeNull();
  });
});

describe("themes", () => {
  it("uses the dark variant in dark mode or auto + prefers dark", () => {
    const a = { tokens: { background: "#ffffff", text: "#111111" }, dark: { tokens: { background: "#000000" } }, font_family: "Inter" };
    expect(resolveTokens({ ...a, theme_mode: "dark" })).toEqual({ font: "Inter", background: "#000000", text: "#111111" });
    expect(resolveTokens({ ...a, theme_mode: "light" }, true).background).toBe("#ffffff");
    expect(wantsDark({ ...a, theme_mode: "auto" }, true)).toBe(true);
    expect(wantsDark({ tokens: {} }, true)).toBe(false); // no dark variant
  });
});

describe("resource center AI answers", () => {
  const rc = (assist: Assist, library: Guide[] = []): HTMLElement => {
    const el = renderModule({ id: "m", module: "search", title: "Help" }, { library, launch: () => {}, opened: () => {}, assist });
    document.body.append(el);
    return el;
  };
  const submit = (el: HTMLElement, q: string): void => {
    el.querySelector("input")!.value = q;
    el.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  };
  it("shows the answer, https citations, suggested guides and records feedback", async () => {
    const searches: unknown[] = [];
    const tour = guide({ id: "t1", name: "Billing tour", kind: "tour" });
    const el = rc(
      {
        ask: async () => ({ answer: "Go to Billing.", citations: [{ title: "Docs", url: "https://docs.test/b" }, { title: "Bad", url: "javascript:alert(1)" }], guide_ids: ["t1"] }),
        searched: (p) => searches.push(p),
      },
      [tour],
    );
    submit(el, "how do I pay");
    await tick();
    expect(el.textContent).toContain("Go to Billing.");
    expect([...el.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://docs.test/b"]);
    expect(el.textContent).toContain("Billing tour");
    [...el.querySelectorAll("button")].find((b) => b.textContent === "Helpful")!.click();
    expect(searches).toEqual([
      { query: "how do I pay", results: 0, answered: true },
      { query: "how do I pay", results: 0, answered: true, feedback: "up" },
    ]);
  });

  it("hides the answer box after a 503 and keeps plain search", async () => {
    let asked = 0;
    const el = rc({ ask: async () => (asked++, "unavailable"), searched: () => {} });
    submit(el, "a");
    await tick();
    submit(el, "b");
    await tick();
    expect(asked).toBe(1);
  });

  it("the module sends $guide_search with the query length, not the text", async () => {
    const rcGuide = guide({ id: "rc", kind: "resource_center", steps: [{ id: "m", module: "search", title: "Help" }] });
    const fetch = (async (url: string) => {
      if (url.includes("/v1/guides/answer")) return new Response(JSON.stringify({ answer: "Yes", citations: [], guide_ids: [] }), { status: 200 });
      if (url.includes("/v1/guides")) return new Response(JSON.stringify({ guides: [rcGuide] }), { status: 200 });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    const r = startWith([flags, guides], { fetch } as never);
    live = r.client;
    await tick(20);
    await vi.waitFor(() => expect(shadow().querySelector("form")).toBeTruthy());
    shadow().querySelector("input")!.value = "secret words";
    shadow().querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await tick(10);
    await live.flush();
    const ev = r.t.events().find((e) => e.event === "$guide_search");
    expect(ev?.properties).toMatchObject({ $guide_id: "rc", query_length: 12, answered: true });
    expect(JSON.stringify(ev)).not.toContain("secret");
  });
});

describe("permalink", () => {
  it("?lc_guide=<id> shows a served guide now and strips the param", async () => {
    history.replaceState({}, "", "/app?x=1&lc_guide=g7");
    const g = guide({ id: "g7", kind: "modal", steps: [{ id: "a", title: "Linked" }], conditions: { delay_seconds: 60 } });
    const r = startWith([flags, guides], { _h: { "/v1/guides": { guides: [g] } } } as never);
    live = r.client;
    expect(location.search).toBe("?x=1");
    await tick(20);
    expect(box().getAttribute("aria-label")).toBe("Linked");
  });

  it("still checks targeting", async () => {
    history.replaceState({}, "", "/app?lc_guide=g7");
    const g = guide({ id: "g7", kind: "modal", steps: [{ id: "a", title: "Linked" }], conditions: { url: "/elsewhere" } });
    live = startWith([flags, guides], { _h: { "/v1/guides": { guides: [g] } } } as never).client;
    await tick(20);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
  });
});

describe("snooze persistence", () => {
  it("a snoozed guide stays hidden until its time, then shows once more", async () => {
    const g = guide({ id: "s1", kind: "modal", steps: [{ id: "a", title: "S", buttons: [{ label: "Later", action: "snooze", snooze_hours: 1 }] }] });
    const opts = { persistence: "localStorage", _h: { "/v1/guides": { guides: [g] } } } as never;
    let r = startWith([flags, guides], opts);
    live = r.client;
    await tick(20);
    click("Later");
    await r.client.flush();
    expect(r.t.events().find((e) => e.event === "$guide_dismissed")?.properties.reason).toBe("snooze");
    await live.shutdown();
    document.body.innerHTML = "";
    resetArbiter();
    r = startWith([flags, guides], opts);
    live = r.client;
    await tick(20);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
    const m = JSON.parse(localStorage.getItem(`lc_guide_snoozed${SUFFIX}`) ?? "{}") as Record<string, number>;
    localStorage.setItem(`lc_guide_snoozed${SUFFIX}`, JSON.stringify({ s1: m.s1! - 2 * 3_600_000 }));
    await live.shutdown();
    resetArbiter();
    live = startWith([flags, guides], opts).client;
    await tick(20);
    expect(box().getAttribute("aria-label")).toBe("S");
  });
});

describe("iframe forwarding (top side)", () => {
  it("draws a forwarded guide from an allowed origin, anchored by the mapped rect", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    stop = listenFrames(["https://child.test"]);
    const post = (data: unknown, origin = "https://child.test"): void =>
      void window.dispatchEvent(new MessageEvent("message", { data, origin, source: frame.contentWindow }));
    const g = guide({ kind: "tooltip", steps: [{ id: "a", title: "In frame", selector: "#x" }] });
    post({ lc: FRAME_MSG, op: "render", key: "k", guide: g }, "https://evil.test");
    expect(document.querySelector("[data-lc-ignore]")).toBeNull(); // origin not allowed
    post({ lc: FRAME_MSG, op: "render", key: "k", guide: g });
    expect(box().getAttribute("aria-label")).toBe("In frame");
    expect(box().style.visibility).toBe("hidden"); // waits for the child to report the target rect
    post({ lc: FRAME_MSG, op: "rects", key: "k", rects: { a: { x: 10, y: 20, width: 5, height: 5 } } });
    await tick(200);
    expect(box().style.visibility).toBe(""); // anchored through the proxy target
    post({ lc: FRAME_MSG, op: "close", key: "k" });
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
  });

  it("a nested frame's message finds the top-level child frame; branches use the frame's own element presence", async () => {
    const outer = document.createElement("iframe");
    document.body.append(outer);
    const inner = outer.contentDocument!.createElement("iframe");
    outer.contentDocument!.body.append(inner);
    stop = listenFrames(["https://child.test"]);
    const post = (data: unknown): void =>
      void window.dispatchEvent(new MessageEvent("message", { data, origin: "https://child.test", source: inner.contentWindow }));
    const g = guide({
      kind: "tour",
      steps: [
        { id: "a", title: "One", branch: [{ op: "element_present", value: "#only-in-frame", goto: "c" }] },
        { id: "b", title: "Two" },
        { id: "c", title: "Three" },
      ],
    } as Partial<Guide>);
    post({ lc: FRAME_MSG, op: "render", key: "n", guide: g });
    expect(box().getAttribute("aria-label")).toBe("One");
    post({ lc: FRAME_MSG, op: "rects", key: "n", rects: {}, present: { "#only-in-frame": true } });
    click("Next");
    expect(box().getAttribute("aria-label")).toBe("Three"); // top has no #only-in-frame, the frame does
  });
});

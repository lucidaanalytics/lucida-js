import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addStep, checkAutomation, newDraft, recordClicks, recordedToDraft, validateDraft, type RecordedStep } from "../src/toolbar/guide-draft.js";
import { requestDraft } from "../src/toolbar/guide-tools.js";
import { deriveTheme, toHex } from "../src/toolbar/theme-derive.js";
import type { ToolbarApi } from "../src/toolbar/api.js";

beforeEach(() => {
  document.body.innerHTML = "";
  history.replaceState({}, "", "/app");
});
afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

describe("derive theme from this page", () => {
  it("converts colors and skips transparent ones", () => {
    expect(toHex("rgb(255, 0, 16)")).toBe("#ff0010");
    expect(toHex("rgba(0, 0, 0, 0)")).toBeNull();
    expect(toHex("#AbC")).toBe("#aabbcc");
    expect(toHex("red")).toBeNull();
  });

  it("reads body colors, font and the primary button", () => {
    document.body.style.cssText = "background-color: rgb(250, 250, 250); color: rgb(17, 17, 17); font-family: Inter, sans-serif";
    const b = Object.assign(document.createElement("button"), { type: "submit", textContent: "Go" });
    b.style.cssText = "background-color: rgb(0, 112, 243); border-top-left-radius: 6px";
    b.getBoundingClientRect = () => ({ width: 80, height: 30 }) as DOMRect; // jsdom has no layout
    document.body.append(b);
    const t = deriveTheme();
    expect(t.tokens).toEqual({ background: "#fafafa", text: "#111111", accent: "#0070f3", radius: 6 });
    expect(t.font_family).toBe("Inter, sans-serif");
  });
});

describe("automation target check", () => {
  it("validates in the page with the SDK's refusals", () => {
    document.body.innerHTML = `<button class="b"></button><button class="b"></button><input id="n"><input id="p" type="password"><select id="s"></select>`;
    expect(checkAutomation({ action: "click", selector: "#n" })).toBeNull();
    expect(checkAutomation({ action: "click", selector: ".b" })).toMatch(/2 elements/);
    expect(checkAutomation({ action: "click", selector: "#none" })).toMatch(/nothing/);
    expect(checkAutomation({ action: "click", selector: "[[" })).toMatch(/invalid/);
    expect(checkAutomation({ action: "fill", selector: "#p", value: "x" })).toMatch(/password/);
    expect(checkAutomation({ action: "fill", selector: "#n" })).toMatch(/value/);
    expect(checkAutomation({ action: "fill", selector: "#s", value: "x" })).toMatch(/text field/);
  });

  it("is part of draft validation", () => {
    const d = newDraft();
    d.name = "T";
    d.kind = "modal";
    addStep(d, { title: "A", automation: { action: "click", selector: "#gone" } });
    expect(validateDraft(d)).toMatch(/Step 1: nothing/);
  });
});

describe("new kinds in draft validation", () => {
  it("carousel 1..10 steps, form_validation needs a field and a rule", () => {
    const c = newDraft();
    c.name = "C";
    c.kind = "carousel";
    for (let i = 0; i < 11; i++) addStep(c, { title: `s${i}` });
    expect(validateDraft(c)).toMatch(/1 to 10/);
    const f = newDraft();
    f.name = "F";
    f.kind = "form_validation";
    addStep(f, { title: "x" });
    expect(validateDraft(f)).toMatch(/field and at least one rule/);
    f.steps[0]!.validation = { selector: "#email", rules: [{ type: "email", message: "Enter an email" }] };
    expect(validateDraft(f)).toBeNull();
  });
});

describe("record mode", () => {
  it("records clicks as stable-selector steps with the page path, ignoring Lucida UI and form values", () => {
    document.body.innerHTML = `<button data-testid="new">New project</button><input id="name" value="secret"><div data-lc-ignore><button id="tb">Toolbar</button></div>`;
    const got: RecordedStep[] = [];
    const stop = recordClicks((s) => got.push(s));
    document.querySelector<HTMLElement>("[data-testid=new]")!.click();
    document.getElementById("name")!.click();
    document.getElementById("tb")!.click();
    stop();
    document.querySelector<HTMLElement>("[data-testid=new]")!.click();
    expect(got).toEqual([
      { selector: '[data-testid="new"]', url: "/app", text: "New project" },
      { selector: "#name", url: "/app" },
    ]);
    const d = recordedToDraft(got);
    expect(d.kind).toBe("tour");
    expect(d.steps.map((s) => [s.selector, s.advance])).toEqual([['[data-testid="new"]', "click"], ["#name", "click"]]);
  });

  it("uses the server draft, else falls back to the recorded tour", async () => {
    const rec = [{ selector: "#a", url: "/app" }];
    const ok = { draftGuide: async () => ({ kind: "tour", name: "AI tour", steps: [{ id: "s1", title: "Hi", selector: "#a" }], targeting: { url: "/app" } }) } as unknown as ToolbarApi;
    expect((await requestDraft(ok, { recorded_steps: rec }))?.name).toBe("AI tour");
    const down = { draftGuide: async () => null } as unknown as ToolbarApi;
    expect((await requestDraft(down, { recorded_steps: rec }))?.name).toBe("Recorded tour");
    expect(await requestDraft(down, { prompt: "x" })).toBeNull();
  });
});

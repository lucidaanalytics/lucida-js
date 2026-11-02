import { afterEach, describe, expect, it } from "vitest";
import { draftRule } from "../src/toolbar/snapshot-picker.js";

afterEach(() => {
  document.body.innerHTML = "";
});

const form = { name: "plan", source: "text", attribute: "", click: true, pageview: false, scope: "page" };

describe("toolbar snapshot-property picker (P-M15)", () => {
  it("builds a rule from the inspected element with the SDK's selector", () => {
    document.body.innerHTML = `<div id="hdr"><span class="plan badge">Pro</span></div><input id="email">`;
    const span = document.querySelector(".plan")!;
    expect(draftRule(span, form)).toEqual({ name: "plan", selector: "div#hdr span.plan.badge", source: "text", events: ["click"] });
    expect(draftRule(span, { ...form, source: "attribute", attribute: "Data-Tier", scope: "target" })).toEqual({
      name: "plan",
      selector: "div#hdr span.plan.badge",
      source: "attribute",
      attribute: "data-tier",
      events: ["click"],
      scope: "target",
    });
  });

  it("refuses form fields, value attributes, $ names and empty event sets", () => {
    document.body.innerHTML = `<input id="email"><p class="x">y</p>`;
    expect(draftRule(document.getElementById("email")!, form)).toMatch(/Form fields/);
    const p = document.querySelector(".x")!;
    expect(draftRule(p, { ...form, source: "attribute", attribute: "value" })).toMatch(/cannot be captured/);
    expect(draftRule(p, { ...form, name: "$plan" })).toMatch(/name/);
    expect(draftRule(p, { ...form, click: false })).toMatch(/click and\/or pageview/);
    expect(draftRule(undefined, form)).toMatch(/Inspect/);
  });
});

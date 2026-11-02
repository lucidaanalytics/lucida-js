import { beforeEach, describe, expect, it } from "vitest";
import { applyChanges, triggerMatches, triggerOf } from "../src/experiments/index.js";
import type { TriggerFacts } from "../src/experiments/index.js";
import { flagSourceProps, placementFlag } from "../src/index.js";

const facts = (f: Partial<TriggerFacts> = {}): TriggerFacts => ({
  pageMs: 0,
  sessionMs: 0,
  pages: 1,
  scroll: 0,
  exit: false,
  visible: () => false,
  events: new Set(),
  manual: false,
  ...f,
});

beforeEach(() => {
  document.head.querySelectorAll("[data-lc-change]").forEach((e) => e.remove());
  document.body.innerHTML = "";
});

describe("activation triggers (N-EXP-6)", () => {
  it("reads only well-formed triggers", () => {
    expect(triggerOf({ lc_trigger: { op: "and", conditions: [{ type: "manual" }] } })).toBeDefined();
    expect(triggerOf({ lc_trigger: { op: "xor", conditions: [{ type: "manual" }] } })).toBeUndefined();
    expect(triggerOf({ lc_trigger: { op: "and", conditions: [] } })).toBeUndefined();
    expect(triggerOf(null)).toBeUndefined();
  });

  it("evaluates AND/OR groups over page facts", () => {
    const t = triggerOf({
      lc_trigger: {
        op: "and",
        conditions: [
          { type: "time_on_page", seconds: 5 },
          { op: "or", conditions: [{ type: "scroll", percent: 50 }, { type: "custom_event", event: "cart_open" }] },
        ],
      },
    })!;
    expect(triggerMatches(t, facts({ pageMs: 4000, scroll: 80 }))).toBe(false);
    expect(triggerMatches(t, facts({ pageMs: 6000, scroll: 80 }))).toBe(true);
    expect(triggerMatches(t, facts({ pageMs: 6000, events: new Set(["cart_open"]) }))).toBe(true);
    expect(triggerMatches(t, facts({ pageMs: 6000 }))).toBe(false);
    expect(triggerMatches({ op: "or", conditions: [{ type: "element_visible", selector: "#cta" }] }, facts({ visible: (s) => s === "#cta" }))).toBe(true);
    expect(triggerMatches({ op: "or", conditions: [{ type: "manual" }] }, facts({ manual: true }))).toBe(true);
    // unknown types (a newer server) never match
    expect(triggerMatches({ op: "or", conditions: [{ type: "future" } as never] }, facts({ manual: true }))).toBe(false);
  });
});

describe("approval stamps (follow-up)", () => {
  it("refuses unapproved CSS, HTML and JS when approval is required", () => {
    document.body.innerHTML = `<p id="p">x</p>`;
    applyChanges(
      [
        { type: "css", css: "p{color:red}" },
        { selector: "#p", type: "insert", position: "after", html: "<b>new</b>" },
      ],
      document,
      { requireApproval: true },
    );
    expect(document.head.querySelectorAll("style[data-lc-change]")).toHaveLength(0);
    expect(document.querySelector("b")).toBeNull();
    applyChanges([{ type: "css", css: "p{color:red}", approved: true }],document, { requireApproval: true });
    expect(document.head.querySelectorAll("style[data-lc-change]")).toHaveLength(1);
  });
});

describe("targeting sources (N-EXP-7)", () => {
  it("copies allow-listed cookies, globals and dataLayer keys as primitives only", () => {
    document.cookie = "plan=pro";
    document.cookie = "secret=nope";
    const w = window as unknown as Record<string, unknown>;
    w.app = { user: { tier: "gold", el: document.body, nested: { a: 1 } } };
    w.dataLayer = [{ page: { type: "pdp" } }, { page: { type: "cart" } }];
    const p = flagSourceProps({
      cookies: ["plan", "bad name"],
      globals: ["app.user.tier", "app.user.el", "app.user.nested", "__proto__.x"],
      data_layer: ["page.type"],
    });
    expect(p["$cookie/plan"]).toBe("pro");
    expect(p["$cookie/secret"]).toBeUndefined();
    expect(p["$global/app.user.tier"]).toBe("gold");
    expect(p["$global/app.user.el"]).toBeUndefined(); // DOM nodes are never read
    expect(p["$global/app.user.nested"]).toBeUndefined();
    expect(p["$datalayer/page.type"]).toBe("cart"); // latest push wins
    expect(flagSourceProps(undefined)).toEqual({});
    delete w.app;
    delete w.dataLayer;
  });
});

describe("recommendations placement (N-EXP-17)", () => {
  it("finds the flag payload configuring a placement", () => {
    const payloads: Record<string, unknown> = {
      a: { other: 1 },
      b: { lc_recs: { placement: "pdp", strategy: "bought_with" } },
    };
    const get = (k: string) => payloads[k];
    expect(placementFlag("pdp", get, ["a", "b"])?.flag).toBe("b");
    expect(placementFlag("home", get, ["a", "b"])).toBeUndefined();
    expect(placementFlag("pdp", get, ["a", "b"], "a")).toBeUndefined();
  });
});

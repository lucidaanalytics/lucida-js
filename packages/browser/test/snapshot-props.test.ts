import { afterEach, describe, expect, it } from "vitest";
import { readSnapshot, snapshotRules } from "../src/autocapture/index.js";
import type { Client } from "../src/index.js";
import { start, tick } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

const PAGE = `<header><span class="plan">Pro plan</span><span class="ssn">4242 4242 4242 4242</span></header>
<div class="product" data-sku="SKU-9"><h2>Lamp</h2><button id="buy">Buy</button></div>
<form><input id="email" class="field" value="a@b.co"></form>
<p data-lc-mask class="hidden-note">secret note</p>`;

describe("snapshot properties (P-M15)", () => {
  it("reads text or one attribute, never form fields, masked elements or card-like digits", () => {
    document.body.innerHTML = PAGE;
    const rules = snapshotRules([
      { name: "plan", selector: ".plan", source: "text", events: ["click", "pageview"] },
      { name: "sku", selector: ".product", source: "attribute", attribute: "data-sku", events: ["click"], scope: "target" },
      { name: "email", selector: "#email", source: "attribute", attribute: "value", events: ["click"] },
      { name: "field", selector: "#email", source: "text", events: ["click"] },
      { name: "note", selector: ".hidden-note", source: "text", events: ["click"] },
      { name: "ssn", selector: ".ssn", source: "text", events: ["click"] },
      { name: "$bad", selector: ".plan", source: "text", events: ["click"] },
      { name: "nope", selector: "::::", source: "text", events: ["click"] },
      { name: "elsewhere", selector: ".plan", source: "text", events: ["click"], url: "/checkout" },
    ]);
    expect(rules.map((r) => r.name)).not.toContain("$bad");
    const buy = document.getElementById("buy")!;
    expect(readSnapshot(rules, "click", buy)).toEqual({ plan: "Pro plan", sku: "SKU-9" });
    expect(readSnapshot(rules, "pageview")).toEqual({ plan: "Pro plan" });
    expect(readSnapshot(rules, "click", document.querySelector(".plan")!)).toEqual({ plan: "Pro plan" });
  });

  it("attaches remote rules to $autocapture clicks", async () => {
    document.body.innerHTML = PAGE;
    const s = start({
      capturePageview: false,
      autocapture: {},
      _h: { "/v1/config": { snapshot_properties: [{ name: "plan", selector: ".plan", source: "text", events: ["click"] }] } },
    } as never);
    live = s.client;
    await tick(20);
    document.getElementById("buy")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await s.client.flush();
    const e = s.t.events().find((x) => x.event === "$autocapture")!;
    expect(e.properties.plan).toBe("Pro plan");
    expect(JSON.stringify(e.properties)).not.toContain("a@b.co");
  });
});

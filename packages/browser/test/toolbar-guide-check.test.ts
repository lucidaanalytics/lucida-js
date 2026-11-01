import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECK_MESSAGE, describeResult, parseCheck, resolveSteps, runCheck } from "../src/toolbar/guide-check.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("guide pre-launch selector check on the live page (G122)", () => {
  it("parses only well-formed requests with an http(s) origin", () => {
    expect(parseCheck(null)).toBeNull();
    expect(parseCheck("{")).toBeNull();
    expect(parseCheck(JSON.stringify({ origin: "javascript:alert(1)", steps: [] }))).toBeNull();
    expect(parseCheck(JSON.stringify({ origin: "https://app.test/path", steps: [{ step: 1, selectors: ["#a", 3, ""] }, { bad: true }] }))).toEqual({
      origin: "https://app.test",
      steps: [{ step: 1, selectors: ["#a"] }],
    });
  });

  it("resolves primary then fallback selectors, flags invalid ones and steps of other pages", () => {
    document.body.innerHTML = `<button id="buy">Buy</button><li class="item"></li><li class="item"></li>`;
    const r = resolveSteps(
      {
        origin: "https://app.test",
        steps: [
          { step: 1, selectors: ["#missing", ".item"] },
          { step: 2, selectors: ["##bad", "#buy"] },
          { step: 3, selectors: ["#nope"] },
          { step: 4, url: "/checkout", selectors: ["#buy"] },
        ],
      },
      "https://shop.test/cart",
    );
    expect(r.map((x) => [x.selector, x.matches, x.onPage, x.invalid])).toEqual([
      [".item", 2, true, []],
      ["#buy", 1, true, ["##bad"]],
      [null, 0, true, []],
      ["#buy", 1, false, []],
    ]);
    expect(describeResult(r[0]!)).toBe("Step 1: .item - 2 matches (hidden)");
    expect(describeResult(r[2]!)).toBe("Step 3: no selector matched");
    expect(describeResult(r[3]!)).toBe("Step 4: on another page");
  });

  it("posts only the results to the opener at the requested origin", async () => {
    document.body.innerHTML = `<b id="x"></b>`;
    const post = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage: post }, configurable: true });
    const notes: string[] = [];
    await runCheck({ origin: "https://app.test", steps: [{ step: 1, selectors: ["#x"] }] }, (t) => notes.push(t), 0);
    expect(post).toHaveBeenCalledWith({ type: CHECK_MESSAGE, url: location.href, results: [expect.objectContaining({ step: 1, selector: "#x", matches: 1 })] }, "https://app.test");
    expect(notes.at(-1)).toContain("Step 1: #x - 1 match");
  });
});

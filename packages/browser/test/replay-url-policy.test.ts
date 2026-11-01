import { describe, expect, it } from "vitest";
import { patternToRegex, policyMatches } from "../src/replay/config.js";

describe("replay URL policy patterns (G43)", () => {
  it("matches substrings with * wildcards, case-insensitively like the server", () => {
    expect(policyMatches(["/checkout"], "https://x.test/Checkout?step=2")).toBe(true);
    expect(policyMatches(["https://*.bank.test/account"], "https://www.bank.test/account/1")).toBe(true);
    expect(policyMatches(["/checkout"], "https://x.test/cart")).toBe(false);
  });

  it("treats re: patterns as regular expressions and ignores invalid ones", () => {
    expect(patternToRegex("re:/orders/\\d+/pay$")).toBe("/orders/\\d+/pay$");
    expect(policyMatches(["re:/orders/\\d+/pay$"], "https://x.test/ORDERS/42/pay")).toBe(true);
    expect(policyMatches(["re:/orders/\\d+/pay$"], "https://x.test/orders/42/pay?x=1")).toBe(false);
    expect(policyMatches(["re:(unclosed"], "https://x.test/")).toBe(false);
  });
});

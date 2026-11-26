import { describe, expect, it } from "vitest";
import { consentFromCookie } from "../src/index.js";

describe("consentFromCookie", () => {
  it("reads the decision", () => {
    expect(consentFromCookie("a=1; lc_consent=granted; lc_distinct_id=x")).toBe("granted");
    expect(consentFromCookie("lc_consent=denied")).toBe("denied");
  });
  it("is undefined without a valid decision", () => {
    expect(consentFromCookie("a=1")).toBeUndefined();
    expect(consentFromCookie("lc_consent=maybe")).toBeUndefined();
    expect(consentFromCookie(undefined)).toBeUndefined();
  });
});

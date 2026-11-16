import { afterEach, describe, expect, it } from "vitest";
import { assetUrl, resolveAssetHost } from "../src/index.js";

afterEach(() => history.replaceState({}, "", "/"));

describe("assetHost as a path", () => {
  it("resolves a site path against the page URL and drops the trailing slash", () => {
    expect(resolveAssetHost("/dashboard/lucida/")).toBe(`${location.origin}/dashboard/lucida`);
    expect(assetUrl(resolveAssetHost("/dashboard/lucida"), "0.1.12", "replay.js")).toBe(`${location.origin}/dashboard/lucida/static/v0.1.12/replay.js`);
  });
  it("keeps an absolute URL as is", () => {
    expect(resolveAssetHost("https://cdn.test/lucida/")).toBe("https://cdn.test/lucida");
  });
});

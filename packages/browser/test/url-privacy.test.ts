import { afterEach, describe, expect, it } from "vitest";
import { privatizeUrl } from "../src/url-privacy.js";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  history.replaceState({}, "", "/");
});

describe("urlPrivacy", () => {
  it("masks named and campaign query params, only in the query, and can drop the fragment", () => {
    const u = "https://a.test/p?email=x%40y.z&utm_source=news&keep=1&gclid=G#email=in-hash";
    expect(privatizeUrl(u, { maskParams: ["email"] })).toBe("https://a.test/p?email=<masked>&utm_source=news&keep=1&gclid=G#email=in-hash");
    expect(privatizeUrl(u, { maskCampaignParams: true, stripHash: true })).toBe("https://a.test/p?email=<masked>&utm_source=<masked>&keep=1&gclid=<masked>");
    expect(privatizeUrl("https://a.test/?notemail=1", { maskParams: ["email"] })).toBe("https://a.test/?notemail=1");
  });

  it("masks well-known sensitive params by default, case-insensitively", () => {
    expect(privatizeUrl("https://a.test/pricing.html?email=a%40b.c&PASSWORD=hunter2&q=shoes&code=1", {})).toBe(
      "https://a.test/pricing.html?email=<masked>&PASSWORD=<masked>&q=shoes&code=<masked>",
    );
  });

  it("applies to $current_url, $referrer and the initial_* person properties on sent events", async () => {
    history.replaceState({}, "", "/landing?token=SECRET&utm_medium=mail#top");
    const { client, t } = start({ autocapture: false, urlPrivacy: { maskParams: ["token"], maskCampaignParams: true, stripHash: true } });
    live = client;
    await client.flush();
    const e = t.events()[0]!;
    expect(e.properties.$current_url).toContain("token=<masked>&utm_medium=<masked>");
    expect(String(e.properties.$current_url)).not.toContain("#");
    expect(JSON.stringify(e)).not.toContain("SECRET");
    expect(e.properties.$utm_medium).toBe("<masked>");
  });
});

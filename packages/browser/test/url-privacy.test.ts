import { afterEach, describe, expect, it } from "vitest";
import { privatizeUrl, urlPrivacyHook } from "../src/url-privacy.js";
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

  it("pathRules rewrite the path only, in order, for absolute URLs and bare paths", () => {
    const p = { pathRules: [{ match: /\/instances\/[^/]+/g, replace: "/instances/:id" }, { match: "/users/\\d+", replace: "/users/:n" }] };
    expect(privatizeUrl("https://a.test/instances/ab12/users/42?x=/users/7#/instances/z", p)).toBe("https://a.test/instances/:id/users/:n?x=/users/7#/instances/z");
    expect(privatizeUrl("/instances/ab12/users/42", p)).toBe("/instances/:id/users/:n");
    expect(privatizeUrl("/x", { pathRules: [{ match: "(", replace: "" }] })).toBe("/x"); // invalid rule is skipped
  });

  it("maskPathIds replaces id-like segments only", () => {
    const u = "https://a.test/u/123e4567-e89b-12d3-a456-426614174000/o/01ARZ3NDEKTSV4RRFFQ69G5FAV/n/12345/h/0123456789abcdef/m/abcDEF123456ghiJKL789x/n/123/plain-slug";
    expect(privatizeUrl(u, { maskPathIds: true })).toBe("https://a.test/u/:id/o/:id/n/:id/h/:id/m/:id/n/123/plain-slug");
    expect(privatizeUrl(u, {})).toBe(u);
  });

  it("the hook applies path rules to $pathname, $current_url, $referrer, $initial_* and autocapture hrefs", () => {
    const hook = urlPrivacyHook({ maskPathIds: true });
    const out = hook({
      event: "$autocapture",
      properties: {
        $pathname: "/users/12345",
        $current_url: "https://a.test/users/12345?a=1",
        $referrer: "https://r.test/users/99999",
        $elements_chain: 'a:href="/users/12345"nth-child="1"nth-of-type="1"',
        $elements: [{ tag_name: "a", href: "/users/12345" }],
      },
      $set_once: { $initial_current_url: "https://a.test/users/12345" },
    } as never) as unknown as { properties: Record<string, unknown>; $set_once: Record<string, unknown> };
    expect(JSON.stringify(out)).not.toContain("12345");
    expect(JSON.stringify(out)).not.toContain("99999");
    expect(out.properties.$pathname).toBe("/users/:id");
    expect(out.properties.$elements_chain).toContain('href="/users/:id"');
  });
});

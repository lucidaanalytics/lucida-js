import { describe, expect, it } from "vitest";
import { appStoreInstallProps, installReferrerProps, resolveInstallProps } from "../src/install";

const okJson = (b: unknown) => ({ ok: true, status: 200, json: async () => b });

describe("install attribution", () => {
  it("parses the referrer", () => {
    const p = installReferrerProps("utm_source=google-play&utm_campaign=a%20b&gclid=G1&junk", 1, 2);
    expect(p).toMatchObject({ $install_store: "google_play", $utm_source: "google-play", $utm_campaign: "a b", $gclid: "G1", $install_begin_ts: 2 });
    expect(p).not.toHaveProperty("$utm_term");
  });

  it("maps the ASA response", () => {
    const p = appStoreInstallProps({ attribution: true, orgId: 9, campaignId: 2, keywordId: 4, adGroupId: 3 });
    expect(p).toMatchObject({ $utm_source: "apple_search_ads", $utm_medium: "cpc", $utm_campaign: "2", $utm_term: "4", $utm_content: "3", $asa_org_id: "9" });
    expect(appStoreInstallProps(null)).toEqual({ $install_store: "app_store" });
    expect(appStoreInstallProps({ attribution: false }).$install_adservices_attribution).toBe(false);
  });

  it("retries 404 on iOS and posts text/plain", async () => {
    const calls: { init?: RequestInit }[] = [];
    const responses = [{ ok: false, status: 404, json: async () => ({}) }, okJson({ attribution: true, campaignId: 7 })];
    const f = (async (_u: string, init?: RequestInit) => (calls.push({ init }), responses.shift())) as unknown as typeof fetch;
    const p = await resolveInstallProps(async () => ({ platform: "ios", token: "t" }), { fetch: f, retryDelayMs: 0 });
    expect(calls).toHaveLength(2);
    expect((calls[0]!.init!.headers as Record<string, string>)["Content-Type"]).toBe("text/plain");
    expect(p.$asa_campaign_id).toBe("7");
  });

  it("degrades to the store on failure", async () => {
    const f = (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch;
    expect(await resolveInstallProps(async () => ({ platform: "ios", token: "t" }), { fetch: f, retryDelayMs: 0 })).toEqual({ $install_store: "app_store" });
    expect(await resolveInstallProps(async () => { throw new Error("x"); }, { fetch: f })).toEqual({});
  });
});

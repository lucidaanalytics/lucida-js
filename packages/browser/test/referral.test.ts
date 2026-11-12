import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cookieMunchBridge } from "../src/consent/index.js";
import type { Client } from "../src/index.js";
import { start, startWith, tick } from "./helpers.js";

beforeEach(() => localStorage.clear());

describe("referral codes", () => {
  it("sets $referral_code and initial_referral_code on the first pageview of a session", async () => {
    history.replaceState({}, "", "/lp?via=friend7");
    const { client, t } = start({ capturePageview: true, autocapture: false, referralParams: ["via"] });
    client.capture("$pageview");
    await client.flush();
    const [first, second] = t.events().filter((x) => x.event === "$pageview");
    expect(first!.properties.$referral_code).toBe("friend7");
    expect(first!.$set_once).toMatchObject({ initial_referral_code: "friend7" });
    expect(second!.properties).not.toHaveProperty("$referral_code");
    await client.shutdown();
  });

  it("honours referralParams and ignores other params", async () => {
    history.replaceState({}, "", "/lp?ref=nope&code=abc");
    const { client, t } = start({ capturePageview: true, autocapture: false, referralParams: ["code"] });
    await client.flush();
    const e = t.events().find((x) => x.event === "$pageview")!;
    expect(e.properties.$referral_code).toBe("abc");
    await client.shutdown();
  });

  it("does nothing with referralParams: []", async () => {
    history.replaceState({}, "", "/lp?ref=x");
    const { client, t } = start({ capturePageview: true, autocapture: false, referralParams: [] });
    await client.flush();
    const e = t.events().find((x) => x.event === "$pageview")!;
    expect(e.properties).not.toHaveProperty("$referral_code");
    expect(e.$set_once).not.toHaveProperty("initial_referral_code");
    await client.shutdown();
  });
});

describe("referral codes: off by default, consent category (0.1.9)", () => {
  it("is off by default", async () => {
    history.replaceState({}, "", "/lp?ref=x");
    const { client, t } = start({ capturePageview: true, autocapture: false });
    await client.flush();
    const e = t.events().find((x) => x.event === "$pageview")!;
    expect(e.properties).not.toHaveProperty("$referral_code");
    await client.shutdown();
  });

  it("object form with default params follows analytics consent", async () => {
    history.replaceState({}, "", "/lp?aff=a1");
    const { client, t } = start({ capturePageview: true, autocapture: false, referralParams: {} });
    await client.flush();
    expect(t.events().find((x) => x.event === "$pageview")!.properties.$referral_code).toBe("a1");
    await client.shutdown();
  });

  describe("with category: referrals", () => {
    let live: Client | undefined;
    const cm = (consent: Record<string, boolean>): void => {
      (window as { CookieMunch?: unknown }).CookieMunch = { hasResponse: true, consent };
      window.dispatchEvent(new Event("CookieMunchOnChange"));
    };
    afterEach(async () => {
      await live?.shutdown();
      live = undefined;
      delete (window as { CookieMunch?: unknown }).CookieMunch;
    });
    const boot = () => {
      history.replaceState({}, "", "/lp?ref=friend");
      const r = startWith([cookieMunchBridge()], { referralParams: { params: ["ref"], category: "referrals" } });
      live = r.client;
      return r;
    };

    it("records nothing while the category is not granted", async () => {
      const { client, t } = boot();
      cm({ statistics: true, referrals: false });
      client.capture("$pageview");
      await client.flush();
      expect(t.events().find((x) => x.event === "$pageview")!.properties).not.toHaveProperty("$referral_code");
    });

    it("records the code once the category is granted", async () => {
      const { client, t } = boot();
      cm({ statistics: true, referrals: true });
      await tick(5);
      client.capture("$pageview");
      await client.flush();
      const e = t.events().find((x) => x.event === "$pageview")!;
      expect(e.properties.$referral_code).toBe("friend");
      expect(e.$set_once).toMatchObject({ initial_referral_code: "friend" });
    });
  });
});

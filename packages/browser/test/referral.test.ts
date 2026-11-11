import { beforeEach, describe, expect, it } from "vitest";
import { start } from "./helpers.js";

beforeEach(() => localStorage.clear());

describe("referral codes", () => {
  it("sets $referral_code and initial_referral_code on the first pageview of a session", async () => {
    history.replaceState({}, "", "/lp?via=friend7");
    const { client, t } = start({ capturePageview: true, autocapture: false });
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

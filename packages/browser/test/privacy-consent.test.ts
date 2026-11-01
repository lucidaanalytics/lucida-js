import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "../src/index.js";
import { fakeFetch, fakeTransport } from "./helpers.js";

const base = { apiHost: "https://ingest.test", capturePageview: false, autocapture: false } as const;

describe("consent API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("exposes getConsent, consentStatus and hasOptedOut", () => {
    const c = init("lc_pk_c1", { ...base, persistence: "memory", transport: fakeTransport(), consent: { mode: "opt_in" } });
    expect(c.consentStatus()).toBe("pending");
    expect(c.hasOptedOut()).toBe(true);
    c.setConsent({ analytics: true });
    expect(c.consentStatus()).toBe("granted");
    expect(c.getConsent().analytics).toBe(true);
    c.optOut();
    expect(c.consentStatus()).toBe("denied");
    expect(c.hasOptedOut()).toBe(true);
  });

  it("beforeSend redacts before the event is queued", async () => {
    const t = fakeTransport();
    const c = init("lc_pk_c2", {
      ...base,
      persistence: "memory",
      transport: t,
      beforeSend: (e) => (e.event === "secret" ? null : { ...e, properties: { ...e.properties, $current_url: "redacted" } }),
    });
    c.capture("secret");
    c.capture("ok");
    await c.flush();
    expect(t.events().map((e) => e.event)).toEqual(["ok"]);
    expect(t.events()[0]!.properties.$current_url).toBe("redacted");
  });

  it("cookielessOnReject sends the held pageview anonymously after a decline", async () => {
    const t = fakeTransport();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const c = init("lc_pk_c3", {
      apiHost: "https://ingest.test",
      autocapture: false,
      persistence: "localStorage",
      transport: t,
      fetch: fakeFetch().fn,
      consent: { mode: "opt_in", cookielessOnReject: true },
    });
    await c.flush();
    expect(t.events()).toHaveLength(0);
    c.setConsent({ analytics: false, replay: false, marketing: false });
    await vi.waitFor(async () => {
      await c.flush();
      expect(t.events().map((e) => e.event)).toContain("$pageview");
    });
    const pv = t.events().find((e) => e.event === "$pageview")!;
    expect(pv).not.toHaveProperty("distinct_id");
    // only the consent decision itself is stored
    expect(setItem.mock.calls.every(([k]) => String(k).startsWith("lc_consent"))).toBe(true);
  });
});

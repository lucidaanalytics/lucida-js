import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CookieStorage, LocalStorageAdapter } from "../src/storage.js";
import { start } from "./helpers.js";

beforeEach(() => {
  document.cookie.split("; ").forEach((c) => (document.cookie = `${c.split("=")[0]}=; Max-Age=0; Path=/`));
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("consent API (LC-SEC-1)", () => {
  it("is pending until an explicit choice, then granted or denied per category", async () => {
    const { client } = start({ consent: { mode: "opt_out" }, capturePageview: false, autocapture: false });
    expect(client.getConsent()).toEqual({ analytics: true, replay: true, marketing: true });
    expect(client.getConsentStatus()).toBe("pending");
    client.setConsent({ analytics: true, marketing: false });
    expect(client.getConsentStatus()).toBe("granted");
    expect(client.getConsentStatus("marketing")).toBe("denied");
    expect(client.getConsent().marketing).toBe(false);
    await client.shutdown();
  });

  it("optIn() grants analytics and replay, never marketing unless named", async () => {
    const { client } = start({ consent: { mode: "opt_in" }, capturePageview: false, autocapture: false });
    client.optIn();
    expect(client.getConsent()).toEqual({ analytics: true, replay: true, marketing: false });
    client.optIn(["analytics", "replay", "marketing"]);
    expect(client.getConsent().marketing).toBe(true);
    client.optIn(["analytics"]);
    expect(client.getConsent()).toEqual({ analytics: true, replay: false, marketing: false });
    await client.shutdown();
  });

  it("opt_in starts denied but still pending", async () => {
    const { client } = start({ consent: { mode: "opt_in" }, capturePageview: false, autocapture: false });
    expect(client.getConsent().analytics).toBe(false);
    expect(client.getConsentStatus()).toBe("pending");
    client.optOut();
    expect(client.getConsentStatus()).toBe("denied");
    await client.shutdown();
  });

  it("reads and writes the decision under a custom storage key", async () => {
    const { client } = start({
      persistence: "localStorage",
      offlineQueue: false,
      consent: { mode: "opt_in", storageKey: "acme_consent" },
      capturePageview: false,
      autocapture: false,
    });
    client.optIn();
    const keys = Object.keys(localStorage);
    expect(keys.some((k) => k.startsWith("acme_consent"))).toBe(true);
    expect(keys.some((k) => k.startsWith("lc_consent"))).toBe(false);
    await client.shutdown();
    // a second instance with the same key sees the stored decision
    const again = start({ persistence: "localStorage", offlineQueue: false, consent: { mode: "opt_in", storageKey: "acme_consent" }, capturePageview: false, autocapture: false });
    expect(again.client.getConsentStatus()).toBe("granted");
    await again.client.shutdown();
    expect(new LocalStorageAdapter().get("lc_consent")).toBeNull();
  });

  it("writes cookies with the configured domain", () => {
    const writes: string[] = [];
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    vi.spyOn(document, "cookie", "set").mockImplementation((v: string) => {
      writes.push(v);
      desc.set!.call(document, v.replace(/; Domain=[^;]+/, ""));
    });
    const shared = new CookieStorage({ domain: ".example.com" });
    shared.set("k", "v");
    shared.remove("k");
    new CookieStorage().set("h", "1");
    expect(writes[0]).toContain("; Path=/; Domain=.example.com;");
    expect(writes[1]).toMatch(/^k=; Max-Age=0; Path=\/; Domain=\.example\.com;/);
    expect(writes[2]).not.toContain("Domain=");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import { osanoConsent, osanoToConsent, usercentricsBridge, usercentricsConsent, usercentricsToConsent } from "../src/consent/index.js";
import type { UcService } from "../src/consent/index.js";
import type { Client, Module } from "../src/index.js";
import { fakeTransport } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  delete (window as { Osano?: unknown }).Osano;
  delete (window as { UC_UI?: unknown }).UC_UI;
});

function boot(modules: Module[]) {
  const t = fakeTransport();
  live = createClient("lc_pk_test", { persistence: "memory", transport: t, offlineQueue: false, apiHost: "https://ingest.test", consent: { mode: "opt_in" } }, modules);
  return { t, client: live };
}
const logs = (t: ReturnType<typeof fakeTransport>) => t.events().filter((e) => e.event === "$consent_updated");

describe("Osano bridge", () => {
  it("maps ANALYTICS / MARKETING", () => {
    expect(osanoToConsent({ ANALYTICS: "ACCEPT", MARKETING: "DENY" })).toEqual({ analytics: true, replay: true, marketing: false });
    expect(osanoToConsent({ ANALYTICS: "DENY", MARKETING: "ACCEPT" })).toEqual({ analytics: false, replay: false, marketing: true });
  });

  it("waits for Osano.cm, applies its consent, then follows consent-saved", async () => {
    const handlers: Record<string, (c: Record<string, string>) => void> = {};
    let current: Record<string, string> = { ANALYTICS: "ACCEPT", MARKETING: "DENY" };
    const { client, t } = boot([osanoConsent]);
    expect(client.getConsent().analytics).toBe(false);
    (window as { Osano?: unknown }).Osano = {
      cm: { getConsent: () => current, addEventListener: (n: string, cb: (c: Record<string, string>) => void) => (handlers[n] = cb), removeEventListener: vi.fn() },
    };
    await vi.waitFor(() => expect(client.getConsent()).toEqual({ analytics: true, replay: true, marketing: false }), { timeout: 2000 });
    current = { ANALYTICS: "ACCEPT", MARKETING: "ACCEPT" };
    handlers["osano-cm-consent-saved"]!(current);
    expect(client.getConsent().marketing).toBe(true);
    await client.flush();
    expect(logs(t).map((e) => e.properties.source)).toEqual(["osano", "osano"]);
  });
});

describe("Usercentrics bridge", () => {
  const svc = (name: string, status: boolean, categorySlug = "functional"): UcService => ({ name, categorySlug, consent: { status } });

  it("maps the Lucida service and the marketing category; no service = no signal", () => {
    expect(usercentricsToConsent([svc("lucida", true), svc("Ads", true, "marketing")])).toEqual({ analytics: true, replay: true, marketing: true });
    expect(usercentricsToConsent([svc("Lucida", true), svc("Ads", false, "marketing")])).toEqual({ analytics: true, replay: true, marketing: false });
    expect(usercentricsToConsent([svc("Other", true)])).toBeUndefined();
    expect(usercentricsToConsent([svc("Analytics", false)], "Analytics")).toEqual({ analytics: false, replay: false, marketing: false });
  });

  it("reads UC_UI now and again on its window events", async () => {
    let list = [svc("Lucida", false)];
    (window as { UC_UI?: unknown }).UC_UI = { getServicesBaseInfo: () => list };
    const { client, t } = boot([usercentricsConsent]);
    expect(client.consentStatus()).toBe("denied");
    list = [svc("Lucida", true)];
    window.dispatchEvent(new Event("UC_UI_CMP_EVENT"));
    expect(client.getConsent().analytics).toBe(true);
    await client.flush();
    expect(logs(t)[0]!.properties).toMatchObject({ source: "usercentrics", categories: { analytics: true } });
  });

  it("a custom service name is honoured; an unknown one leaves consent alone", () => {
    (window as { UC_UI?: unknown }).UC_UI = { getServicesBaseInfo: () => [svc("Product Analytics", true)] };
    const a = boot([usercentricsBridge("Product Analytics")]);
    expect(a.client.getConsent().analytics).toBe(true);
    void a.client.shutdown();
    const b = boot([usercentricsConsent]);
    expect(b.client.consentStatus()).toBe("pending");
  });
});

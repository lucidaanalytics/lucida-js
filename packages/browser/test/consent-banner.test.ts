import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import { consentBanner, cookiebotConsent, cookiebotToConsent, oneTrustConsent, oneTrustToConsent } from "../src/consent/index.js";
import type { BrowserConfig, Client, Module } from "../src/index.js";
import { fakeTransport } from "./helpers.js";
import { until } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
  delete (window as { OnetrustActiveGroups?: string }).OnetrustActiveGroups;
  delete (window as { Cookiebot?: unknown }).Cookiebot;
});

function boot(cfg: BrowserConfig = {}, modules: Module[] = [consentBanner], fetchFn?: typeof fetch) {
  const t = fakeTransport();
  live = createClient("lc_pk_test", { persistence: "memory", transport: t, offlineQueue: false, apiHost: "https://ingest.test", ...(fetchFn ? { fetch: fetchFn } : {}), ...cfg }, modules);
  return { t, client: live };
}
const dialog = (): HTMLElement | null => document.querySelector("[role=dialog]");
const button = (label: string): HTMLButtonElement => [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("consent banner (LC-SEC-17)", () => {
  it("is a no-op without the module", async () => {
    const { client } = boot({}, []);
    expect(await client.consent.showBanner()).toBeNull();
    expect(dialog()).toBeNull();
  });

  it("renders an accessible dialog with custom texts, focuses it and accept-all grants and logs $consent_updated", async () => {
    const { client, t } = boot({ consent: { mode: "opt_in", policyVersion: "v7" } });
    const done = client.consent.showBanner({ texts: { title: "Cookies <b>x</b>", acceptAll: "Allow" }, position: "bottom-right", version: "2" });
    await until(() => !!dialog());
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(d.getAttribute("aria-labelledby")!)!.textContent).toBe("Cookies <b>x</b>"); // text, never HTML
    expect(d.querySelector("b")).toBeNull();
    expect(document.activeElement).toBe(button("Allow"));
    button("Allow").click();
    const state = await done;
    expect(state).toEqual({ analytics: true, replay: true, marketing: true });
    expect(dialog()).toBeNull();
    await client.flush();
    const rec = t.events().find((e) => e.event === "$consent_updated");
    expect(rec?.properties).toMatchObject({ categories: state, source: "banner", version: "2" });
  });

  it("per-category save; reject all denies; nothing stored for a denial without logBeacon", async () => {
    const { client, t } = boot({ consent: { mode: "opt_out" } });
    let p = client.consent.showBanner({ categories: ["analytics", "marketing"] });
    await until(() => !!dialog());
    (document.getElementById([...document.querySelectorAll("input")][1]!.id) as HTMLInputElement).checked = false;
    button("Save choices").click();
    expect(await p).toMatchObject({ analytics: true, marketing: false });
    p = client.consent.showBanner();
    await until(() => !!dialog());
    button("Reject all").click();
    expect(await p).toEqual({ analytics: false, replay: false, marketing: false });
    await client.flush();
    const logs = t.events().filter((e) => e.event === "$consent_updated");
    expect(logs).toHaveLength(1); // the denial is not an event: analytics consent no longer exists
    expect(logs[0]!.properties.categories).toMatchObject({ marketing: false });
  });

  it("logBeacon: a decline sends one anonymous consent record, nothing else", async () => {
    const posts: Array<{ url: string; body: { batch: Array<{ properties: Record<string, unknown>; distinct_id?: string }> } }> = [];
    const f = (async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const { client, t } = boot({ consent: { mode: "opt_in", logBeacon: true } }, [consentBanner], f);
    const p = client.consent.showBanner();
    await until(() => !!dialog());
    button("Reject all").click();
    await p;
    expect(t.calls).toHaveLength(0);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("https://ingest.test/v1/batch");
    const ev = posts[0]!.body.batch[0]!;
    expect(ev.distinct_id).toBeUndefined();
    expect(Object.keys(ev.properties).sort()).toEqual(["$lib", "categories", "source", "version"]);
  });

  it("traps Tab inside the dialog, Escape dismisses without storing and restores focus", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    const { client } = boot({ consent: { mode: "opt_in" } });
    const p = client.consent.showBanner();
    await until(() => !!dialog());
    const items = [...dialog()!.querySelectorAll<HTMLElement>("button, input")];
    items.at(-1)!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[0]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items.at(-1));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await p).toBeNull();
    expect(client.setConsent).toBeDefined();
    expect(document.activeElement).toBe(outside);
    expect(dialog()).toBeNull();
  });

  it("remote: takes copy, categories and position from the project's consent_banner; options win", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      const banner = { title: "Cookies here", body: "Project copy", accept_label: "Yes", decline_label: "No", customize_label: "Keep mine", position: "bottom_left", categories: [{ id: "necessary", label: "Needed", required: true }, { id: "analytics", label: "Stats" }, { id: "replay", label: "Recordings" }] };
      return new Response(JSON.stringify({ consent_banner: banner }));
    }) as unknown as typeof fetch;
    const { client } = boot({ consent: { mode: "opt_in" } }, [consentBanner], f);
    const p = client.consent.showBanner({ remote: true, texts: { rejectAll: "Decline" } });
    await until(() => !!dialog());
    expect(urls).toEqual(["https://ingest.test/v1/config?api_key=lc_pk_test"]);
    expect(dialog()!.querySelector("h2")!.textContent).toBe("Cookies here");
    expect(dialog()!.style.left).toBe("1rem");
    expect([...dialog()!.querySelectorAll("label")].map((l) => l.textContent!.trim())).toEqual(["Stats", "Recordings"]);
    expect(button("Decline")).toBeDefined();
    button("Keep mine").click();
    expect(await p).toMatchObject({ analytics: false, replay: false });
  });

  it("remote: a failed config read keeps the built-in copy", async () => {
    const f = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const { client } = boot({}, [consentBanner], f);
    void client.consent.showBanner({ remote: true });
    await until(() => !!dialog());
    expect(dialog()!.querySelector("h2")!.textContent).toBe("Your privacy");
  });

  it("skips the fade under prefers-reduced-motion", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    try {
      const { client } = boot();
      void client.consent.showBanner();
      await until(() => !!dialog());
      expect(dialog()!.style.transition).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("OneTrust and Cookiebot bridges", () => {
  it("maps groups and consent objects", () => {
    expect(oneTrustToConsent(",C0001,C0002,")).toEqual({ analytics: true, replay: true, marketing: false });
    expect(oneTrustToConsent(["C0001", "C0004"])).toEqual({ analytics: false, replay: false, marketing: true });
    expect(cookiebotToConsent({ statistics: true, marketing: true })).toEqual({ analytics: true, replay: true, marketing: true });
  });

  it("OneTrust: follows OneTrustGroupsUpdated and logs once per change", async () => {
    const { client, t } = boot({ consent: { mode: "opt_in" } }, [oneTrustConsent]);
    expect(client.getFlag).toBeDefined();
    window.dispatchEvent(new CustomEvent("OneTrustGroupsUpdated", { detail: ["C0001", "C0002"] }));
    window.dispatchEvent(new CustomEvent("OneTrustGroupsUpdated", { detail: ["C0001", "C0002"] })); // unchanged: not re-logged
    await client.flush();
    expect(t.events().filter((e) => e.event === "$consent_updated")).toHaveLength(1);
    expect(t.events().find((e) => e.event === "$consent_updated")!.properties).toMatchObject({ source: "onetrust", categories: { analytics: true } });
  });

  it("Cookiebot: reads Cookiebot.consent on its events", async () => {
    const { client, t } = boot({ consent: { mode: "opt_in" } }, [cookiebotConsent]);
    (window as { Cookiebot?: unknown }).Cookiebot = { hasResponse: true, consent: { statistics: true, marketing: false } };
    window.dispatchEvent(new Event("CookiebotOnAccept"));
    await client.flush();
    expect(client.consent).toBeDefined();
    expect(t.events().find((e) => e.event === "$consent_updated")!.properties).toMatchObject({ source: "cookiebot", categories: { analytics: true, marketing: false } });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { cookieMunchBridge, cookieMunchToConsent, cookiebotConsent } from "../src/consent/index.js";
import type { Client, Module } from "../src/index.js";
import { fakeTransport } from "./helpers.js";

let live: Client | undefined;
const clearCookies = (): void => document.cookie.split("; ").forEach((c) => (document.cookie = `${c.split("=")[0]}=; Max-Age=0; Path=/`));
beforeEach(clearCookies);
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  delete (window as { CookieMunch?: unknown }).CookieMunch;
  delete (window as { Cookiebot?: unknown }).Cookiebot;
  clearCookies();
});

function boot(modules: Module[]) {
  const t = fakeTransport();
  live = createClient("lc_pk_test", { persistence: "memory", transport: t, offlineQueue: false, apiHost: "https://ingest.test", consent: { mode: "opt_in" } }, modules);
  return { t, client: live };
}
const cm = (v: unknown): void => void ((window as { CookieMunch?: unknown }).CookieMunch = v);
const fire = (): boolean => window.dispatchEvent(new Event("CookieMunchOnChange"));

describe("CMP bridge lc_consent cookie", () => {
  it("writes no lc_* cookie before a decision, then granted / denied on each decision", () => {
    boot([cookieMunchBridge()]);
    cm({ hasResponse: false, consent: { statistics: false } });
    fire();
    expect(document.cookie).not.toMatch(/lc_/);
    cm({ hasResponse: true, consent: { statistics: true } });
    fire();
    expect(document.cookie).toContain("lc_consent=granted");
    cm({ hasResponse: true, consent: { statistics: false } });
    fire();
    expect(document.cookie).toContain("lc_consent=denied");
  });

  it("other bridges write it too", () => {
    boot([cookiebotConsent]);
    (window as { Cookiebot?: unknown }).Cookiebot = { hasResponse: true, consent: { statistics: true } };
    window.dispatchEvent(new Event("CookiebotOnAccept"));
    expect(document.cookie).toContain("lc_consent=granted");
  });
});

describe("Cookie Munch receipt and replay category", () => {
  it("adds consent_receipt_id when Cookie Munch provides one", async () => {
    const { client, t } = boot([cookieMunchBridge()]);
    cm({ hasResponse: true, receiptId: "rcpt_1", consent: { statistics: true } });
    fire();
    await client.flush();
    expect(t.events().find((e) => e.event === "$consent_updated")!.properties).toMatchObject({ consent_receipt_id: "rcpt_1" });
  });

  it("omits consent_receipt_id when there is none", async () => {
    const { client, t } = boot([cookieMunchBridge()]);
    cm({ hasResponse: true, consent: { statistics: true } });
    fire();
    await client.flush();
    expect(t.events().find((e) => e.event === "$consent_updated")!.properties).not.toHaveProperty("consent_receipt_id");
  });

  it("maps a custom category to replay separately from statistics", () => {
    expect(cookieMunchToConsent({ statistics: true, session_replay: false }, "session_replay")).toMatchObject({ analytics: true, replay: false });
    expect(cookieMunchToConsent({ statistics: false, session_replay: true }, "session_replay")).toMatchObject({ analytics: false, replay: true });
    expect(cookieMunchToConsent({ statistics: true })).toMatchObject({ analytics: true, replay: true });
  });
});

describe("cookieMunchBridge $cm_subject_id", () => {
  const subjectEvents = async (client: Client, t: ReturnType<typeof fakeTransport>) => {
    await new Promise((r) => setTimeout(r, 0));
    await client.flush();
    return t.events().filter((e) => (e as { $set?: Record<string, unknown> }).$set?.$cm_subject_id !== undefined || e.properties.$set !== undefined);
  };

  it("sets it after identify from getSubjectId, never when the app passed its own or the id is empty", async () => {
    const { t, client } = boot([cookieMunchBridge()]);
    cm({ hasResponse: true, consent: { statistics: true }, getSubjectId: async () => "sub_1" });
    fire();
    client.identify("u1");
    expect(JSON.stringify(await subjectEvents(client, t))).toContain("sub_1");
    const own = boot([cookieMunchBridge()]);
    own.client.identify("u2", { $cm_subject_id: "mine" });
    expect(JSON.stringify(await subjectEvents(own.client, own.t))).not.toContain("sub_1");
    cm({ hasResponse: true, consent: { statistics: true }, getSubjectId: async () => undefined });
    expect(() => client.identify("u3")).not.toThrow();
  });
});

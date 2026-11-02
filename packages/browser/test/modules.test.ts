import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlagDefinition } from "@lucida-analytics/sdk-core";
import { autocapture } from "../src/autocapture/index.js";
import { gcmConsent, gcmToConsent, tcfConsent, tcfToConsent } from "../src/consent/index.js";
import { flags } from "../src/flags/index.js";
import { createClient } from "../src/client.js";
import { describeEvent, inspector } from "../src/inspector/index.js";
import { toolbar } from "../src/toolbar/index.js";
import { correlate, correlatable, withBaggage } from "../src/watchtower/correlate.js";
import type { Client } from "../src/index.js";
import { fakeFetch, fakeTransport, startWith, tick } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => {
  history.replaceState({}, "", "/p");
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(async () => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  await live?.shutdown();
  live = undefined;
});

describe("consent adapters", () => {
  it("maps TCF purposes and ignores non-GDPR contexts", () => {
    expect(tcfToConsent({ purpose: { consents: { 1: true, 7: true, 8: true, 4: false } } })).toEqual({ analytics: true, replay: true, marketing: false });
    expect(tcfToConsent({ purpose: { consents: { 1: true, 7: true } } })).toEqual({ analytics: true, replay: false, marketing: false });
    expect(tcfToConsent({ purpose: { consents: { 7: true } } })?.analytics).toBe(false); // needs purpose 1
    expect(tcfToConsent({ gdprApplies: false })).toBeUndefined();
  });
  it("follows __tcfapi events into Lucida consent (opt_in)", async () => {
    let cb: (d: object, ok: boolean) => void = () => {};
    (window as unknown as { __tcfapi: unknown }).__tcfapi = (_c: string, _v: number, f: typeof cb) => (cb = f);
    const { client, t } = startWith([tcfConsent], { consent: { mode: "opt_in" } });
    live = client;
    cb({ eventStatus: "cmpuishown" }, true);
    client.capture("before");
    cb({ eventStatus: "useractioncomplete", purpose: { consents: { 1: true, 7: true, 8: true } } }, true);
    client.capture("after");
    delete (window as unknown as { __tcfapi?: unknown }).__tcfapi;
    await client.flush();
    expect(t.events().map((e) => e.event)).toEqual(expect.arrayContaining(["after"]));
    expect(t.events().map((e) => e.event)).not.toContain("before");
  });
  it("maps Consent Mode v2 states", () => {
    expect(gcmToConsent({ analytics_storage: "granted", ad_storage: "denied" })).toEqual({ analytics: true, replay: true, marketing: false });
    expect(gcmToConsent({ ad_storage: "granted", ad_user_data: "denied" })).toEqual({ marketing: false });
    expect(gcmToConsent({ analytics_storage: "denied" })).toEqual({ analytics: false, replay: false });
  });
  it("applies gtag consent default (existing entries) and later updates", async () => {
    const dl: unknown[] = [];
    (window as unknown as { dataLayer: unknown[] }).dataLayer = dl;
    (function (..._a: unknown[]) {
      dl.push(arguments); // what gtag() really pushes: an Arguments object
    })("consent", "default", { analytics_storage: "denied" });
    const { client, t } = startWith([gcmConsent], { consent: { mode: "opt_out" } });
    live = client;
    client.capture("blocked");
    await client.flush();
    expect(t.events().map((e) => e.event)).not.toContain("blocked");
    (function (..._a: unknown[]) {
      dl.push(arguments);
    })("consent", "update", { analytics_storage: "granted" });
    client.capture("allowed");
    await client.flush();
    expect(t.events().map((e) => e.event)).toContain("allowed");
    delete (window as unknown as { dataLayer?: unknown }).dataLayer;
  });
});

describe("pending pageview after opt-in", () => {
  it("re-fires the dropped $pageview once analytics is granted (and only once)", async () => {
    const { client, t } = startWith([autocapture], { consent: { mode: "opt_in" }, capturePageview: "history", autocapture: false });
    live = client;
    client.capture("x");
    await client.flush();
    expect(t.events()).toHaveLength(0);
    client.setConsent({ analytics: true });
    await client.flush();
    expect(t.events().filter((e) => e.event === "$pageview")).toHaveLength(1);
    client.setConsent({ replay: true });
    await client.flush();
    expect(t.events().filter((e) => e.event === "$pageview")).toHaveLength(1);
  });
  it("does not double-fire when queueBeforeConsent already holds it", async () => {
    const { client, t } = startWith([autocapture], { consent: { mode: "opt_in", queueBeforeConsent: true }, capturePageview: "history", autocapture: false });
    live = client;
    client.setConsent({ analytics: true });
    await client.flush();
    expect(t.events().filter((e) => e.event === "$pageview")).toHaveLength(1);
  });
});

describe("watchtower baggage", () => {
  it("merges lucida.session_id into baggage, replacing a stale value", () => {
    expect(withBaggage(null, "abc")).toBe("lucida.session_id=abc");
    expect(withBaggage("userId=1, lucida.session_id=old", "new")).toBe("userId=1,lucida.session_id=new");
  });
  it("same-origin and allowlisted origins only", () => {
    expect(correlatable("/api/x")).toBe(true);
    expect(correlatable(`${location.origin}/api`)).toBe(true);
    expect(correlatable("https://api.partner.test/x")).toBe(false);
    expect(correlatable("https://api.partner.test/x", ["https://api.partner.test"])).toBe(true);
    expect(correlatable("https://evil.test/x", [/partner\.test/])).toBe(false);
    expect(correlatable("https://evil.test/?partner.test", [/^https:\/\/api\.partner\.test/])).toBe(false);
  });
  it("adds the header to same-origin + allowlisted fetch, never to other origins or the ingest host", async () => {
    const seen: Array<{ url: string; baggage: string | null }> = [];
    const realFetch = window.fetch;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), baggage: new Headers(init?.headers).get("baggage") });
      return new Response("{}");
    }) as typeof fetch;
    const { client } = startWith([correlate], { watchtower: { correlate: true, origins: ["https://api.partner.test"] } });
    live = client;
    client.capture("e"); // session id is read from captured events
    await window.fetch("/api/orders", { headers: { baggage: "a=b" } });
    await window.fetch("https://api.partner.test/v1");
    await window.fetch("https://third.party.test/pixel");
    await window.fetch("https://ingest.test/v1/batch");
    expect(seen[0]!.baggage).toMatch(/^a=b,lucida\.session_id=[0-9a-f-]{36}$/);
    expect(seen[1]!.baggage).toMatch(/^lucida\.session_id=/);
    expect(seen[2]!.baggage).toBeNull();
    expect(seen[3]!.baggage).toBeNull();
    await client.shutdown();
    live = undefined;
    expect(window.fetch).not.toBe(realFetch); // restored to our stub, not the patched one
    window.fetch = realFetch;
  });
  it("adds it to same-origin XHR and is inert unless watchtower.correlate", async () => {
    const hdrs: string[] = [];
    const proto = XMLHttpRequest.prototype;
    const origSet = proto.setRequestHeader;
    const origSend = proto.send;
    proto.setRequestHeader = function (k: string, v: string) {
      hdrs.push(`${k}=${v}`);
    };
    proto.send = () => {};
    const { client } = startWith([correlate], { watchtower: { correlate: true } });
    live = client;
    const x = new XMLHttpRequest();
    x.open("GET", "/api/z");
    x.send();
    const y = new XMLHttpRequest();
    y.open("GET", "https://other.test/z");
    y.send();
    expect(hdrs).toHaveLength(1);
    expect(hdrs[0]).toMatch(/^baggage=lucida\.session_id=/);
    await client.shutdown();
    live = undefined;
    const before = window.fetch;
    const off = startWith([correlate], {});
    live = off.client;
    expect(window.fetch).toBe(before);
    proto.setRequestHeader = origSet;
    proto.send = origSend;
  });
});

describe("offline queue", () => {
  it("persists undeliverable batches and replays them on `online` (opt_in: not before consent)", async () => {
    const f = fakeFetch({ "/v1/batch": {} });
    let up = false;
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (!up) throw new TypeError("offline");
      return f.fn(url, init);
    }) as unknown as typeof fetch;
    const client = createClient("lc_pk_off", { persistence: "localStorage", apiHost: "https://ingest.test", fetch: fetchImpl, capturePageview: false, autocapture: false });
    live = client;
    client.capture("while-offline");
    await client.flush();
    const key = Object.keys(localStorage).find((k) => k.startsWith("lc_offline_"))!;
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1);
    expect(localStorage.getItem(key)).toContain("while-offline");
    up = true;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(calls.filter((u) => u.includes("/v1/batch"))).toHaveLength(2);
  });
  it("is off with offlineQueue:false", async () => {
    const client = createClient("lc_pk_off2", { persistence: "localStorage", offlineQueue: false, apiHost: "https://ingest.test", fetch: (async () => { throw new TypeError("x"); }) as unknown as typeof fetch, capturePageview: false, autocapture: false });
    live = client;
    client.capture("e");
    await client.flush();
    expect(Object.keys(localStorage).some((k) => k.startsWith("lc_offline_"))).toBe(false);
  });
});

describe("local flag evaluation", () => {
  const defs: FlagDefinition[] = [
    { key: "on", type: "boolean", active: true, salt: "s", conditions: [{ rollout_pct: 100 }], aggregation: { kind: "person" } },
    { key: "off", type: "boolean", active: false, salt: "s", conditions: [{ rollout_pct: 100 }], aggregation: { kind: "person" } },
    { key: "cohort", type: "boolean", active: true, salt: "s", conditions: [{ rollout_pct: 100, filters: [{ type: "cohort", key: "c1", op: "in" as never }] }], aggregation: { kind: "person" } },
  ];
  it("decides in the browser without a network call when nothing needs the server", async () => {
    const { client, f } = startWith([flags], { localFlags: defs.slice(0, 2) });
    live = client;
    expect(client.getFlag("on")).toBe(true);
    expect(client.getFlag("off")).toBe(false);
    await client.reloadFlags();
    expect(f.calls.filter((c) => c.url.includes("/v1/flags"))).toHaveLength(0);
  });
  it("asks the server for flags that need it, keeping local answers for the rest", async () => {
    const { client, f } = startWith([flags], { localFlags: defs, _h: { "/v1/flags": { flags: { cohort: { enabled: true } } } } } as never);
    live = client;
    await vi.waitFor(() => expect(client.getFlag("cohort")).toBe(true));
    expect(f.calls.some((c) => c.url.includes("/v1/flags"))).toBe(true);
    expect(client.getFlag("on")).toBe(true);
  });
  it("toolbar overrides win locally", () => {
    localStorage.setItem("lc_flag_overrides", JSON.stringify({ on: false }));
    const { client } = startWith([flags], { localFlags: defs.slice(0, 1) });
    live = client;
    expect(client.getFlag("on")).toBe(false);
  });
});

describe("toolbar", () => {
  const session = { token: "tok", project_id: "p1", scopes: ["actions:write"], origin: "http://localhost", expires_at: "2030-01-01T00:00:00Z" };
  it("is inert without ?__lc_toolbar and makes no request", async () => {
    const { client, f } = startWith([toolbar]);
    live = client;
    await tick(10);
    expect(f.calls).toHaveLength(0);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
  });
  it("exchanges the token, strips it from the URL, mounts, and creates an action draft with the bearer token", async () => {
    history.replaceState({}, "", "/p?__lc_toolbar=one-time&x=1");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/v1/toolbar/exchange")) return new Response(JSON.stringify(session));
      if (url.endsWith("/actions")) return new Response(JSON.stringify({ id: "a1", name: "Buy button", steps: [] }));
      if (url.includes("/heatmaps/elements"))
        return new Response(JSON.stringify({ key: "selector", next_cursor: null, data: [{ selector: "button#b", clicks: 3, rage_clicks: 1, dead_clicks: 0, click_share: 1 }] }));
      if (url.includes("/heatmaps?")) return new Response(JSON.stringify({ bins: [{ x: 1, y: 1, count: 3, sessions: 1 }], total: 3, max: 3, x_bins: 50, y_bin_px: 20 }));
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    document.body.innerHTML = `<button id="b">Buy now</button>`;
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    const root = await vi.waitFor(() => Array.from(document.querySelectorAll("[data-lc-ignore]")).find((e) => e.shadowRoot)!.shadowRoot!.host);
    expect(location.search).toBe("?x=1");
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({ token: "one-time", origin: location.origin });
    expect(root.shadowRoot).toBeTruthy();
    const buttons = () => Array.from(root.shadowRoot!.querySelectorAll("button"));
    const by = (label: string) => buttons().find((b) => b.textContent === label)!;
    by("Inspect element").click();
    document.getElementById("b")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    by("Actions").click();
    root.shadowRoot!.querySelector<HTMLInputElement>("input[placeholder='Action name']")!.value = "Buy button";
    by("Add picked element").click();
    by("Save action").click();
    const act = await vi.waitFor(() => {
      const c = calls.find((c) => c.url.endsWith("/v1/projects/p1/actions") && c.init?.method === "POST");
      if (!c) throw new Error("action not posted");
      return c;
    });
    expect((act.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(act.init!.body as string)).toEqual({
      name: "Buy button",
      steps: [{ selector: "#b", text: "Buy now", text_match: "exact", url: "/p", url_match: "contains" }],
    });
    by("Heatmap").click();
    by("Show heatmap").click();
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes("/v1/projects/p1/heatmaps?url=%2Fp&") && c.url.includes("type=click"))).toBe(true);
      expect(document.querySelector("canvas")).toBeTruthy();
      expect(root.shadowRoot!.textContent).toContain("1: 3 clicks, 1 rage");
    });
    expect(JSON.parse(sessionStorage.getItem("lc_toolbar_session")!).session_token).toBe("tok");
  });
  it("a rejected token mounts nothing", async () => {
    history.replaceState({}, "", "/p?__lc_toolbar=bad");
    let hits = 0;
    const { client } = startWith([toolbar], { fetch: (async () => (hits++, new Response("no", { status: 401 }))) as unknown as typeof fetch });
    live = client;
    await vi.waitFor(() => expect(hits).toBe(1));
    await tick(20);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
  });
  it("the token never reaches $current_url", async () => {
    history.replaceState({}, "", "/p?__lc_toolbar=secrettoken&a=1");
    const { client, t } = startWith([], {});
    live = client;
    client.capture("e");
    await client.flush();
    expect(JSON.stringify(t.events())).not.toContain("secrettoken");
  });
});

describe("inspector", () => {
  it("is off by default, on with ?__lc_debug=1, and lists captured events + consent", async () => {
    const off = startWith([inspector]);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
    await off.client.shutdown();
    history.replaceState({}, "", "/p?__lc_debug=1");
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { client } = startWith([inspector]);
    live = client;
    client.capture("hello", { a: 1 });
    const root = document.querySelector("[data-lc-ignore]")!;
    const text = root.shadowRoot!.textContent!;
    expect(text).toContain("hello");
    expect(text).toContain('"a": 1');
    expect(text).toContain("consent a:1");
    expect(describeEvent({ event: "e", timestamp: "2026-01-01T10:11:12.345Z" } as never)).toBe("10:11:12.345  e");
  });
});

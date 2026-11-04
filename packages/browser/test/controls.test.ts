import { afterEach, describe, expect, it, vi } from "vitest";
import { CookieStorage, broadestDomain, knownRegistrable } from "../src/storage.js";
import { browserTransport } from "../src/transport.js";
import { hostListed } from "../src/host-headers.js";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const base = { capturePageview: false, autocapture: false } as const;

describe("methods", () => {
  it("setPersonProperties / unsetPersonProperties send $set events", async () => {
    const { client, t } = start(base);
    live = client;
    client.setPersonProperties({ plan: "pro" }, { first: 1 });
    client.unsetPersonProperties(["old"]);
    client.setPersonProperties();
    await client.flush();
    const ev = t.events() as unknown as Array<{ event: string; $set?: object; $set_once?: object; $unset?: string[] }>;
    expect(ev.map((e) => e.event)).toEqual(["$set", "$set"]);
    expect(ev[0]).toMatchObject({ $set: { plan: "pro" }, $set_once: { first: 1 } });
    expect(ev[1]!.$unset).toEqual(["old"]);
  });

  it("getSessionId, onSessionId (initial + rotation), getProperty, hasOptedOut", async () => {
    const { client } = start({ ...base, session: { idleMs: 60_000 } }); // the minimum idle timeout
    live = client;
    const seen: string[] = [];
    const off = client.onSessionId((s) => seen.push(s));
    const first = client.getSessionId();
    expect(seen).toEqual([first]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61_000);
    const second = client.getSessionId();
    vi.useRealTimers();
    expect(second).not.toBe(first);
    expect(seen).toEqual([first, second]);
    off();
    client.register({ plan: "x" });
    expect(client.getProperty("plan")).toBe("x");
    expect(client.getProperty("nope")).toBeUndefined();
    expect(client.hasOptedOut()).toBe(false);
    client.optOut();
    expect(client.hasOptedOut()).toBe(true);
  });

  it("capture options: timestamp, sendInstantly, beacon transport, bad timestamp ignored", async () => {
    const { client, t } = start({ ...base, flushAt: 100 });
    live = client;
    client.capture("old", {}, { timestamp: "2020-01-02T03:04:05.000Z" });
    client.capture("bad", {}, { timestamp: "nonsense" });
    expect(t.calls).toHaveLength(0);
    client.capture("now", {}, { sendInstantly: true });
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    expect(t.calls[0]!.beacon).toBe(false);
    client.capture("unload", {}, { transport: "beacon" });
    await vi.waitFor(() => expect(t.calls).toHaveLength(2));
    expect(t.calls[1]!.beacon).toBe(true);
    const all = t.events();
    expect(all.find((e) => e.event === "old")!).toMatchObject({ timestamp: "2020-01-02T03:04:05.000Z" });
    expect(Number.isNaN(Date.parse((all.find((e) => e.event === "bad") as unknown as { timestamp: string }).timestamp))).toBe(false);
  });

  it("reuseAnonymousId keeps the first anonymous id across reset; default mints a new one", () => {
    const a = start({ ...base, reuseAnonymousId: true });
    const first = a.client.distinctId;
    a.client.identify("u1");
    a.client.reset();
    expect(a.client.distinctId).toBe(first);
    const b = start(base);
    live = b.client;
    const f2 = b.client.distinctId;
    b.client.reset();
    expect(b.client.distinctId).not.toBe(f2);
  });

  it("featureView / featureInteraction events mark the person", async () => {
    const { client, t } = start(base);
    live = client;
    client.featureView("new-nav");
    client.featureInteraction("new-nav", { area: "menu" });
    await client.flush();
    const ev = t.events() as unknown as Array<{ event: string; properties: Record<string, unknown>; $set?: object }>;
    expect(ev[0]).toMatchObject({ event: "$feature_view", properties: { $feature_flag: "new-nav" }, $set: { "$feature_view/new-nav": true } });
    expect(ev[1]).toMatchObject({ event: "$feature_interaction", properties: { area: "menu" }, $set: { "$feature_interaction/new-nav": true } });
  });

  it("debug toggles at runtime and with ?__lucida_debug=1", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { client } = start(base);
    live = client;
    client.capture("quiet");
    expect(spy.mock.calls.some((c) => c[1] === "capture")).toBe(false);
    client.debug(true);
    client.capture("loud");
    expect(spy.mock.calls.some((c) => c[1] === "capture")).toBe(true);
    client.debug(false);
    spy.mockClear();
    history.replaceState({}, "", "/?__lucida_debug=1");
    const again = start(base);
    again.client.capture("x");
    expect(spy.mock.calls.some((c) => c[1] === "capture")).toBe(true);
    history.replaceState({}, "", "/");
    void again.client.shutdown();
  });

  it("getReplayUrl uses uiHost, else apiHost, with optional timestamp", () => {
    const { client } = start({ ...base, uiHost: "https://app.example.com/" });
    live = client;
    const sid = client.getSessionId();
    expect(client.getReplayUrl()).toBe(`https://app.example.com/replays/${sid}`);
    expect(client.getReplayUrl({ withTimestamp: true })).toMatch(/\?t=\d+$/);
    const other = start(base);
    expect(other.client.getReplayUrl()).toMatch(/^https:\/\/ingest\.test\/replays\//);
    void other.client.shutdown();
  });
});

describe("bootstrap", () => {
  it("uses sessionId and isIdentified", () => {
    const { client } = start({ ...base, bootstrap: { distinctId: "u1", isIdentified: true, sessionId: "sess-boot" } });
    live = client;
    expect(client.distinctId).toBe("u1");
    expect(client.getSessionId()).toBe("sess-boot");
  });

  it("an identified bootstrap user is not linked to an anonymous id on identify(same id)", async () => {
    const { client, t } = start({ ...base, bootstrap: { distinctId: "u1", isIdentified: true } });
    live = client;
    client.identify("u1");
    await client.flush();
    expect(t.events()).toEqual([]);
  });
});

describe("tracing headers", () => {
  it("matches exact hosts and leading-dot suffixes", () => {
    expect(hostListed("https://api.example.com/x", ["api.example.com"])).toBe(true);
    expect(hostListed("https://a.b.example.com/x", [".example.com"])).toBe(true);
    expect(hostListed("https://example.com/x", [".example.com"])).toBe(true);
    expect(hostListed("https://badexample.com/x", [".example.com"])).toBe(false);
    expect(hostListed("https://api.example.com.evil.test/x", ["api.example.com"])).toBe(false);
  });

  it("adds both headers to listed hosts only, never to ingest, and nothing without consent", async () => {
    const seen: Array<{ url: string; h: Headers }> = [];
    const realFetch = window.fetch;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), h: new Headers(init?.headers) });
      return new Response("{}");
    }) as typeof fetch;
    const { client } = start({ ...base, tracingHeaders: ["api.example.com", "localhost"] });
    await window.fetch("https://api.example.com/orders", { headers: { "x-a": "1" } });
    await window.fetch("/local");
    await window.fetch("https://other.test/x");
    await window.fetch("https://ingest.test/v1/batch");
    const dist = client.distinctId;
    expect(seen[0]!.h.get("X-Lucida-Distinct-Id")).toBe(dist);
    expect(seen[0]!.h.get("X-Lucida-Session-Id")).toBe(client.getSessionId());
    expect(seen[0]!.h.get("x-a")).toBe("1");
    expect(seen[1]!.h.get("X-Lucida-Session-Id")).not.toBeNull();
    expect(seen[2]!.h.get("X-Lucida-Distinct-Id")).toBeNull();
    expect(seen[3]!.h.get("X-Lucida-Distinct-Id")).toBeNull();
    client.optOut();
    await window.fetch("https://api.example.com/again");
    expect(seen[4]!.h.get("X-Lucida-Distinct-Id")).toBeNull();
    await client.shutdown();
    window.fetch = realFetch;
  });

  it("is inert without tracingHeaders", async () => {
    const before = window.fetch;
    const { client } = start(base);
    live = client;
    expect(window.fetch).toBe(before);
  });
});

describe("cookie options", () => {
  function jar() {
    const writes: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((v) => void writes.push(v));
    return writes;
  }

  it("expiry days, secure override, explicit domain", () => {
    const writes = jar();
    new CookieStorage({ expiryDays: 2, secure: true, domain: "example.com" }).set("k", "v");
    expect(writes[0]).toBe("k=v; Max-Age=172800; Path=/; Domain=example.com; SameSite=Lax; Secure");
    writes.length = 0;
    new CookieStorage({ secure: false }).set("k", "v");
    expect(writes[0]).toBe("k=v; Max-Age=31536000; Path=/; SameSite=Lax");
  });

  it("crossSubdomain falls back to the host when the browser accepts no parent domain", () => {
    const writes = jar();
    new CookieStorage({ crossSubdomain: true }).set("k", "v");
    expect(writes.filter((w) => !w.startsWith("__lc_probe"))[0]).not.toContain("Domain=");
  });

  it("broadestDomain probes from the broadest suffix the browser accepts, and skips IPs", () => {
    const writes: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((v) => void writes.push(v));
    vi.spyOn(document, "cookie", "get").mockImplementation(() => (writes.some((w) => w.startsWith("__lc_probe=1; Domain=b.example.com")) ? "__lc_probe=1" : ""));
    expect(broadestDomain("a.b.example.com")).toBe("b.example.com");
    expect(broadestDomain("10.0.0.1")).toBeUndefined();
    expect(broadestDomain("localhost")).toBeUndefined();
  });

  it("without a probe answer, falls back to the registrable domain for known multi-label suffixes", () => {
    vi.spyOn(document, "cookie", "set").mockImplementation(() => undefined);
    vi.spyOn(document, "cookie", "get").mockImplementation(() => "");
    expect(broadestDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(broadestDomain("a.b.my-app.vercel.app")).toBe("my-app.vercel.app");
    expect(broadestDomain("a.b.example.com")).toBeUndefined(); // single-label suffix: host-only, as before
    expect(knownRegistrable("Docs.Example.COM.AU")).toBe("example.com.au");
    expect(knownRegistrable("co.uk")).toBeUndefined();
    expect(knownRegistrable("www.shop.com.pt")).toBe("shop.com.pt"); // country second level not in the explicit list
    expect(knownRegistrable("a.b.example.co.zm")).toBe("example.co.zm");
    expect(knownRegistrable("www.example.io")).toBeUndefined(); // io is a plain single-label suffix
    expect(knownRegistrable("user.github.io")).toBe("user.github.io");
  });

  it("writes nothing before consent (opt_in) even with cookie options", () => {
    const writes = jar();
    const { client } = start({ ...base, persistence: "cookie", cookie: { crossSubdomain: true }, consent: { mode: "opt_in" } });
    live = client;
    client.register({ a: 1 });
    expect(writes).toEqual([]);
  });
});

describe("ingest transport options", () => {
  it("extra headers and onRequestError", async () => {
    const seen: Array<Record<string, string>> = [];
    const errors: Array<{ url: string; status: number }> = [];
    const f = (async (_u: string, init?: RequestInit) => {
      seen.push(init!.headers as Record<string, string>);
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;
    const tr = browserTransport(f, { headers: { "X-Key": "k" }, onError: (e) => errors.push(e) });
    await tr.send("https://h/v1/batch", "{}");
    expect(seen[0]).toMatchObject({ "X-Key": "k", "Content-Type": "text/plain;charset=UTF-8" });
    expect(errors).toEqual([{ url: "https://h/v1/batch", status: 500 }]);
    const failing = browserTransport((async () => Promise.reject(new TypeError("x"))) as unknown as typeof fetch, { onError: (e) => errors.push(e) });
    await expect(failing.send("https://h/b", "{}")).resolves.toEqual({ status: 0 });
    expect(errors[1]!.status).toBe(0);
  });

  it("disableBeacon uses fetch for unload flushes", async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const calls: string[] = [];
    const f = (async (u: string) => (calls.push(u), new Response("", { status: 200 }))) as unknown as typeof fetch;
    await browserTransport(f, { disableBeacon: true }).send("https://h/v1/batch", "{}", { beacon: true });
    expect(beacon).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    await browserTransport(f).send("https://h/v1/batch", "{}", { beacon: true });
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});

describe("campaign params", () => {
  it("customCampaignParams ride on $pageview and become $initial_*", async () => {
    history.replaceState({}, "", "/?ref_code=abc&utm_source=x");
    const { client, t } = start({ capturePageview: true, autocapture: false, customCampaignParams: ["ref_code"] });
    live = client;
    await client.flush();
    const pv = t.events().find((e) => e.event === "$pageview")!;
    expect(pv.properties).toMatchObject({ $ref_code: "abc", $utm_source: "x" });
    expect(pv.$set_once).toMatchObject({ $initial_ref_code: "abc" });
    history.replaceState({}, "", "/");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorage } from "../src/storage.js";
import { start, tick } from "./helpers.js";

beforeEach(() => {
  history.replaceState({}, "", "/start");
  document.cookie.split("; ").forEach((c) => (document.cookie = `${c.split("=")[0]}=; Max-Age=0; Path=/`));
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("capture basics", () => {
  it("adds lib and page properties", async () => {
    const { client, t } = start({ capturePageview: false, autocapture: false });
    client.capture("custom", { a: 1 });
    await client.flush();
    const e = t.events()[0]!;
    expect(t.calls[0]!.url).toBe("https://ingest.test/v1/batch");
    expect(e.properties).toMatchObject({
      a: 1,
      $lib: "lucida-browser",
      $current_url: "http://localhost:3000/start",
      $screen_width: expect.any(Number),
      $viewport_width: expect.any(Number),
      $browser_language: expect.any(String),
      $timezone: expect.any(String),
    });
    await client.shutdown();
  });

  it("flushes with sendBeacon on pagehide", async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const { client } = start({ capturePageview: false, autocapture: false, persistence: "memory", transport: undefined as never });
    await tick(20);
    client.capture("bye");
    window.dispatchEvent(new Event("pagehide"));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect((beacon.mock.calls[0] as unknown[])[0]).toBe("https://ingest.test/v1/batch");
    await client.shutdown();
  });

  it("debug mode logs calls", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { client } = start({ debug: true, capturePageview: false, autocapture: false });
    client.capture("x");
    expect(spy.mock.calls.some((c) => c[0] === "[lucida]" && c[1] === "capture")).toBe(true);
  });

  it("disabled mode does nothing", async () => {
    const { client, t } = start({ disabled: true });
    client.capture("x");
    await client.flush();
    expect(t.calls).toHaveLength(0);
  });
});

describe("campaign attribution", () => {
  it("captures utm + click ids on pageview and $set_once initial_*", async () => {
    history.replaceState({}, "", "/lp?utm_source=news&utm_medium=email&utm_campaign=x&gclid=G1&fbclid=F1");
    const { client, t } = start({ autocapture: false });
    await client.flush();
    const e = t.events().find((x) => x.event === "$pageview")!;
    expect(e.properties).toMatchObject({ $utm_source: "news", $utm_medium: "email", $utm_campaign: "x", $gclid: "G1", $fbclid: "F1" });
    expect(e.$set_once).toMatchObject({
      $initial_utm_source: "news",
      $initial_gclid: "G1",
      $initial_current_url: expect.stringContaining("/lp?"),
      $initial_referrer: "$direct",
    });
    await client.shutdown();
  });

  it("captures gad_source, igshid, mc_cid and custom campaign params", async () => {
    history.replaceState({}, "", "/lp?gad_source=1&igshid=I1&mc_cid=M1&ref=partner&other=no");
    const { client, t } = start({ autocapture: false, customCampaignParams: ["ref"] });
    await client.flush();
    const e = t.events().find((x) => x.event === "$pageview")!;
    expect(e.properties).toMatchObject({ $gad_source: "1", $igshid: "I1", $mc_cid: "M1", $ref: "partner" });
    expect(e.properties).not.toHaveProperty("$other");
    expect(e.$set_once).toMatchObject({ $initial_ref: "partner", $initial_gad_source: "1" });
    await client.shutdown();
  });

  it("rotates session when UTM campaign changes", async () => {
    history.replaceState({}, "", "/a?utm_source=one");
    const { client, t } = start({ capturePageview: false, autocapture: false });
    client.capture("e1");
    history.replaceState({}, "", "/a?utm_source=two");
    client.capture("e2");
    await client.flush();
    const [a, b] = t.events();
    expect(a!.properties.$session_id).not.toBe(b!.properties.$session_id);
    await client.shutdown();
  });
});

describe("consent: opt_in", () => {
  for (const persistence of ["cookie", "localStorage"] as const) {
    it(`${persistence}: no network and no storage writes before grant, writes after`, async () => {
      const cookieSet = vi.spyOn(document, "cookie", "set");
      const lsSet = vi.spyOn(Storage.prototype, "setItem");
      const { client, t, f } = start({
        persistence,
        consent: { mode: "opt_in", queueBeforeConsent: true },
        _h: { "/v1/flags": { flags: { f1: true } }, "/v1/config": {} },
      } as never);
      client.capture("early");
      client.identify("u1");
      client.register({ a: 1 });
      await client.flush();
      await new Promise((r) => setTimeout(r, 10));
      expect(t.calls).toHaveLength(0);
      expect(f.calls).toHaveLength(0);
      expect(cookieSet).not.toHaveBeenCalled();
      expect(lsSet).not.toHaveBeenCalled();
      expect(document.cookie).toBe("");

      client.optIn();
      await client.flush();
      await new Promise((r) => setTimeout(r, 10));
      expect(persistence === "cookie" ? cookieSet.mock.calls.length : lsSet.mock.calls.length).toBeGreaterThan(0);
      expect(t.events().map((e) => e.event)).toEqual(expect.arrayContaining(["early", "$identify", "$opt_in"]));
      expect(f.calls.some((c) => c.url.endsWith("/v1/flags"))).toBe(true);
      await client.shutdown();
    });
  }
});

describe("storage adapters", () => {
  it("cookie and localStorage round-trip, namespaced by key", () => {
    for (const kind of ["cookie", "localStorage", "memory"] as const) {
      const s = createStorage(kind, "lc_pk_abcdefgh");
      s.set("k", "v=1; x");
      expect(s.get("k")).toBe("v=1; x");
      s.remove("k");
      expect(s.get("k")).toBeNull();
    }
  });
});

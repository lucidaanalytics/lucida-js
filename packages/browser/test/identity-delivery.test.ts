import { afterEach, describe, expect, it, vi } from "vitest";
import { visualChanges } from "../src/experiments/index.js";
import { renderGuide } from "../src/guides/index.js";
import { LINKER_PARAM, decodeLink, decodeLinker, encodeLinker } from "../src/linker.js";
import { INGESTION_WARNING } from "../src/policy.js";
import { assetUrl, blocksInlineStyle, rewriteUrl } from "../src/index.js";
import type { Client, Guide } from "../src/index.js";
import { start, startWith } from "./helpers.js";

const base = { capturePageview: false, autocapture: false } as const;
let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

type Ev = { event: string; properties: Record<string, unknown>; $set_once?: Record<string, unknown> };
const evs = (t: ReturnType<typeof start>["t"]) => t.events() as unknown as Ev[];

describe("personProfiles identified_only: createPersonProfile and pre-identify $set_once (G82)", () => {
  it("keeps the initial values from personless pageviews and sends them with the profile, earliest first", async () => {
    history.replaceState(null, "", "/landing?utm_source=news");
    const { client, t } = start({ capturePageview: false, autocapture: false, personProfiles: "identified_only" });
    live = client;
    client.capture("$pageview");
    history.replaceState(null, "", "/later?utm_source=ads");
    client.capture("$pageview");
    client.createPersonProfile();
    client.createPersonProfile(); // already a profile: no second event
    client.capture("after");
    await client.flush();
    const ev = evs(t);
    expect(ev.map((e) => e.event)).toEqual(["$pageview", "$pageview", "$set", "after"]);
    expect(ev[0]!.properties.$process_person_profile).toBe(false);
    expect(ev[0]!.$set_once).toBeUndefined();
    expect(ev[2]!.properties.$process_person_profile).toBeUndefined();
    expect(ev[2]!.$set_once).toMatchObject({ $initial_utm_source: "news" });
    expect(String(ev[2]!.$set_once!.$initial_current_url)).toContain("/landing");
    expect(ev[3]!.$set_once).toBeUndefined();
  });

  it("identify() carries the kept values too; 'always' and 'never' make createPersonProfile a no-op", async () => {
    const a = start({ ...base, personProfiles: "identified_only" });
    a.client.capture("$pageview");
    a.client.identify("u1");
    await a.client.flush();
    const idf = evs(a.t).find((e) => e.event === "$identify")!;
    expect(idf.$set_once).toHaveProperty("$initial_referrer");
    await a.client.shutdown();
    for (const mode of ["always", "never"] as const) {
      const s = start({ ...base, personProfiles: mode });
      s.client.createPersonProfile();
      await s.client.flush();
      expect(s.t.events()).toHaveLength(0);
      await s.client.shutdown();
    }
  });

  it("keeps nothing in storage before consent", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const s = start({ ...base, persistence: "localStorage", personProfiles: "identified_only", consent: { mode: "opt_in", queueBeforeConsent: true } });
    live = s.client;
    s.client.capture("$pageview");
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("cross-domain linker carries the session (LC-ING-42)", () => {
  it("new format round-trips; old links still decode; old readers still get id and time", () => {
    const now = 1_700_000_000_000;
    const sid = "0190f0a2-1111-7000-8000-000000000001";
    const v = encodeLinker("user.1@x.io", now, sid);
    expect(decodeLink(v, now)).toEqual({ distinctId: "user.1@x.io", sessionId: sid });
    expect(decodeLink(encodeLinker("a.b", now), now)).toEqual({ distinctId: "a.b" });
    // what an older SDK does with a new link: id before the last dot, parseInt of the rest stops at "_"
    const i = v.lastIndexOf(".");
    expect([v.slice(0, i), parseInt(v.slice(i + 1), 36)]).toEqual(["user.1@x.io", now]);
    expect(decodeLinker(`${encodeLinker("x", now)}_bad id!`, now)).toBe("x");
  });

  it("landing adopts the carried distinct id and session id; outgoing links carry the current session", () => {
    const ms = Date.now().toString(16).padStart(12, "0"); // a fresh UUIDv7: carried ids older than 24 h are refused
    const sid = `${ms.slice(0, 8)}-${ms.slice(8)}-7000-8000-000000000002`;
    history.replaceState(null, "", `/land?${LINKER_PARAM}=${encodeURIComponent(encodeLinker("carried", Date.now(), sid))}`);
    const { client } = start({ ...base, crossDomains: ["b.com"] });
    live = client;
    expect(client.distinctId).toBe("carried");
    expect(client.getSessionId()).toBe(sid);
    document.body.innerHTML = `<a id="a" href="https://b.com/x">a</a>`;
    document.getElementById("a")!.addEventListener("click", (e) => e.preventDefault()); // jsdom cannot navigate
    document.getElementById("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const out = new URL((document.getElementById("a") as HTMLAnchorElement).href).searchParams.get(LINKER_PARAM)!;
    expect(decodeLink(out)).toEqual({ distinctId: "carried", sessionId: sid });
  });
});

describe("delivery: $lib_custom_api_host, rewritePath, asset paths", () => {
  it("$lib_custom_api_host is set only for a non-default api host", async () => {
    const custom = start(base);
    custom.client.capture("e");
    await custom.client.flush();
    expect(custom.t.events()[0]!.properties.$lib_custom_api_host).toBe("https://ingest.test");
    await custom.client.shutdown();
    const def = start({ ...base, apiHost: undefined } as never);
    live = def.client;
    def.client.capture("e");
    await def.client.flush();
    expect(def.t.events()[0]!.properties).not.toHaveProperty("$lib_custom_api_host");
  });

  it("rewritePath renames ingest and module request paths on the api host only", async () => {
    const { client, t, f } = start({
      capturePageview: false,
      autocapture: false,
      rewritePath: (p: string) => p.replace(/^\/v1\//, "/lc/"),
      _h: { "/lc/flags": { flags: {} } },
    } as never);
    live = client;
    client.capture("e");
    await client.flush();
    expect(t.calls[0]!.url).toBe("https://ingest.test/lc/batch");
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.startsWith("https://ingest.test/lc/flags"))).toBe(true));
    expect(rewriteUrl("https://other.test/v1/x?a=1", ["https://ingest.test"], () => "/no")).toBe("https://other.test/v1/x?a=1");
    expect(rewriteUrl("https://ingest.test/v1/config?k=1#h", ["https://ingest.test"], (p) => `/p${p}`)).toBe("https://ingest.test/p/v1/config?k=1#h");
  });

  it("assetUrl builds immutable versioned paths", () => {
    expect(assetUrl("https://cdn.test//", "1.2.3", "replay.js")).toBe("https://cdn.test/static/v1.2.3/replay.js");
  });
});

describe("CSP nonce and doctor hint (LC-DX-29)", () => {
  it("the experiment veil and guide styles carry the nonce", async () => {
    const s = startWith([visualChanges], { nonce: "n0nce", visualChanges: { antiFlickerMs: 5000 } });
    live = s.client;
    expect(document.head.querySelector("style")!.getAttribute("nonce")).toBe("n0nce");
    const g: Guide = { id: "g", name: "G", kind: "modal", steps: [{ id: "a", title: "Hi" }], conditions: {} };
    const noop = () => {};
    const stop = renderGuide(g, { shown: noop, step: noop, completed: noop, dismissed: noop, event: noop }, noop, { nonce: "n0nce" });
    const host = [...document.body.querySelectorAll("div")].find((d) => d.shadowRoot)!;
    expect(host.shadowRoot!.querySelector("style")!.getAttribute("nonce")).toBe("n0nce");
    stop();
  });

  it("blocksInlineStyle reads style-src-elem / style-src / default-src", () => {
    expect(blocksInlineStyle("default-src 'self'")).toBe(true);
    expect(blocksInlineStyle("style-src 'self' 'unsafe-inline'")).toBe(false);
    expect(blocksInlineStyle("style-src 'unsafe-inline' 'nonce-abc'")).toBe(true);
    expect(blocksInlineStyle("script-src 'self'")).toBe(false);
  });

  it("debug mode logs a hint when a meta CSP blocks inline styles and no nonce is set", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", "default-src 'self'; style-src 'self'");
    document.head.append(meta);
    const dbg = vi.spyOn(console, "debug").mockImplementation(() => {});
    live = start({ ...base, debug: true }).client;
    expect(dbg.mock.calls.some((c) => String(c[1]).includes("CSP hint"))).toBe(true);
    dbg.mockClear();
    void live.shutdown();
    live = start({ ...base, debug: true, nonce: "x" }).client;
    expect(dbg.mock.calls.some((c) => String(c[1]).includes("CSP hint"))).toBe(false);
  });
});

describe("client limits (G85)", () => {
  it("rate-limit drops emit one $$client_ingestion_warning per window with the count", async () => {
    const { client, t } = start({ ...base, rateLimit: { eventsPerSecond: 0.001, burst: 2 } });
    live = client;
    for (let i = 0; i < 5; i++) client.capture(`e${i}`);
    await Promise.resolve(); // the warning is captured in a microtask after the burst
    for (let i = 5; i < 8; i++) client.capture(`e${i}`); // same window: counted, no second warning
    await Promise.resolve();
    await client.flush();
    const ev = evs(t);
    expect(ev.filter((e) => e.event.startsWith("e")).map((e) => e.event)).toEqual(["e0", "e1"]);
    const warn = ev.filter((e) => e.event === INGESTION_WARNING);
    expect(warn).toHaveLength(1);
    expect(warn[0]!.properties.$dropped_count).toBe(3);
  });

  it("capture listeners never see an event beforeSend drops", async () => {
    const seen: string[] = [];
    const { client } = startWith(
      [(host) => void host.onCapture((e) => seen.push(e.event))],
      { autocapture: false, beforeSend: (e) => (e.event === "drop" ? null : e) },
    );
    live = client;
    client.capture("drop");
    client.capture("keep");
    expect(seen).toEqual(["keep"]);
  });
});

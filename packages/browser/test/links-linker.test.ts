import { afterEach, describe, expect, it, vi } from "vitest";
import { tag404 } from "../src/autocapture/index.js";
import { LINKER_PARAM, decodeLinker, encodeLinker, hostMatches } from "../src/linker.js";
import type { Client } from "../src/index.js";
import { start, tick } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  await live?.shutdown();
});

const click = (sel: string) => document.querySelector(sel)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const names = (s: ReturnType<typeof start>) => (s.client.flush(), s.t.events().map((e) => e.event));

function setup(html: string, config: object = {}) {
  document.body.innerHTML = html;
  const s = start({ capturePageview: false, ...config } as never);
  live = s.client;
  return s;
}

describe("outbound links, downloads, site search", () => {
  it("captures outbound clicks without query or hash, and file downloads by extension", async () => {
    const s = setup(
      `<a id="o" href="https://other.example/p?token=secret#x">o</a><a id="d" href="/files/Report.PDF?x=1">d</a><a id="i" href="/local">i</a>`,
    );
    for (const id of ["#o", "#d", "#i"]) click(id);
    await s.client.flush();
    const ev = s.t.events().filter((e) => e.event !== "$autocapture");
    expect(ev.map((e) => e.event)).toEqual(["$outbound_click", "$file_download"]);
    expect(ev[0]!.properties).toMatchObject({ $url: "https://other.example/p", $outbound_host: "other.example" });
    expect(ev[1]!.properties).toMatchObject({ $file_name: "Report.PDF", $file_extension: "pdf" });
  });

  it("toggles and a custom extension list are honoured; ignored subtrees stay silent", async () => {
    const s = setup(
      `<a id="o" href="https://other.example/">o</a><a id="d" href="/a.pdf">d</a><a id="x" href="/a.bin">x</a><div data-lc-ignore><a id="g" href="https://z.example/">g</a></div>`,
      { autocapture: { outboundLinks: false, fileDownloads: ["bin"] } },
    );
    for (const id of ["#o", "#d", "#x", "#g"]) click(id);
    await s.client.flush();
    expect(s.t.events().filter((e) => e.event.startsWith("$file") || e.event.startsWith("$out")).map((e) => e.properties.$file_extension)).toEqual(["bin"]);
  });

  it("captures $site_search from q/s/search/query on pageview, with custom params", async () => {
    history.replaceState(null, "", "/results?query=%20red+shoes%20&utm_source=x");
    const s = start({ capturePageview: "history", persistence: "memory" });
    live = s.client;
    await tick(20); // the first pageview waits briefly for the remote snapshot rules
    await s.client.flush();
    const e = s.t.events().find((x) => x.event === "$site_search")!;
    expect(e.properties).toMatchObject({ $search_term: "red shoes", $search_param: "query" });
    await live.shutdown();
    history.replaceState(null, "", "/r?term=hats");
    const s2 = start({ autocapture: { siteSearch: { params: ["term"] } } });
    live = s2.client;
    await tick(20);
    await s2.client.flush();
    expect(s2.t.events().find((x) => x.event === "$site_search")!.properties.$search_term).toBe("hats");
    await live.shutdown();
    const s3 = start({ autocapture: { siteSearch: false } });
    live = s3.client;
    await tick(20);
    await s3.client.flush();
    expect(s3.t.events().some((x) => x.event === "$site_search")).toBe(false);
  });

  it("tag404 captures $page_not_found", async () => {
    const s = setup("");
    tag404(s.client, { reason: "gone" });
    await s.client.flush();
    expect(s.t.events()[0]).toMatchObject({ event: "$page_not_found", properties: { $status: 404, reason: "gone" } });
  });
});

describe("DNT and GPC", () => {
  const nav = (dnt: string | null, gpc: boolean) => {
    Object.defineProperty(navigator, "doNotTrack", { value: dnt, configurable: true });
    Object.defineProperty(navigator, "globalPrivacyControl", { value: gpc, configurable: true });
  };
  afterEach(() => {
    delete (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl;
    delete (navigator as { doNotTrack?: string }).doNotTrack;
  });

  it("ignores DNT and GPC by default", () => {
    nav("1", true);
    live = start().client;
    live.capture("x");
    expect(live.distinctId).toBeTruthy();
  });

  it("respectDnt denies in opt_out mode; respectGpc does the same for GPC", async () => {
    nav("1", false);
    let s = start({ respectDnt: true });
    await s.client.flush();
    s.client.capture("a");
    await s.client.flush();
    expect(s.t.events()).toEqual([]);
    await s.client.shutdown();
    nav(null, true);
    s = start({ respectDnt: true });
    s.client.capture("b");
    await s.client.flush();
    expect(s.t.events().map((e) => e.event)).toContain("b"); // DNT only: GPC alone does not matter
    await s.client.shutdown();
    s = start({ respectGpc: true });
    s.client.capture("c");
    await s.client.flush();
    expect(s.t.events()).toEqual([]);
    expect(s.client.distinctId).toBeTruthy();
    s.client.setConsent({ analytics: true }); // an explicit choice still wins
    s.client.capture("d");
    await s.client.flush();
    expect(s.t.events().map((e) => e.event)).toContain("d");
    live = s.client;
  });
});

describe("cross-domain linker", () => {
  it("encodes and decodes with a 2 minute expiry", () => {
    const now = 1_700_000_000_000;
    const v = encodeLinker("user.1@x.io", now);
    expect(decodeLinker(v, now + 119_000)).toBe("user.1@x.io");
    expect(decodeLinker(v, now + 121_000)).toBeUndefined();
    expect(decodeLinker(v, now - 60_000)).toBeUndefined();
    expect(decodeLinker("garbage")).toBeUndefined();
    expect(hostMatches("shop.b.com", ["b.com"])).toBe(true);
    expect(hostMatches("notb.com", ["b.com"])).toBe(false);
  });

  it("decorates links to configured domains after consent, not others", async () => {
    const s = setup(`<a id="a" href="https://b.com/x">a</a><a id="c" href="https://c.com/">c</a>`, { crossDomains: ["b.com"] });
    await tick(20);
    click("#a");
    click("#c");
    const href = (id: string) => (document.querySelector(id) as HTMLAnchorElement).href;
    const v = new URL(href("#a")).searchParams.get(LINKER_PARAM)!;
    expect(decodeLinker(v)).toBe(s.client.distinctId);
    expect(href("#c")).toBe("https://c.com/");
  });

  it("does not decorate before consent", () => {
    const s = setup(`<a id="a" href="https://b.com/x">a</a>`, { crossDomains: ["b.com"], consent: { mode: "opt_in" } });
    click("#a");
    expect((document.querySelector("#a") as HTMLAnchorElement).href).toBe("https://b.com/x");
    expect(s.client.distinctId).toBeTruthy();
  });

  it("adopts the carried id on landing and strips the param", async () => {
    history.replaceState(null, "", `/land?a=1&${LINKER_PARAM}=${encodeURIComponent(encodeLinker("carried-id"))}`);
    const s = start({ crossDomains: ["b.com"] });
    await tick(20);
    live = s.client;
    expect(s.client.distinctId).toBe("carried-id");
    expect(location.search).toBe("?a=1");
  });

  it("ignores an expired id but still strips it; ignores everything when crossDomains is unset", () => {
    const old = encodeLinker("old", Date.now() - 3 * 60_000);
    history.replaceState(null, "", `/?${LINKER_PARAM}=${old}`);
    live = start({ crossDomains: ["b.com"] }).client;
    expect(live.distinctId).not.toBe("old");
    expect(location.search).toBe("");
    history.replaceState(null, "", `/?${LINKER_PARAM}=${encodeLinker("fresh")}`);
    const s = start({});
    expect(s.client.distinctId).not.toBe("fresh");
    expect(location.search).toContain(LINKER_PARAM);
  });
});

describe("internal traffic", () => {
  it("optOutInternal adds $internal to every event and persists, after consent", async () => {
    const s = start({ persistence: "localStorage", consent: { mode: "opt_in" } });
    live = s.client;
    s.client.optOutInternal();
    expect(localStorage.getItem("lc_internal_lc_pk_test".replace("lc_pk_test", ""))).toBeNull(); // nothing written before consent
    expect(Object.keys(localStorage).some((k) => k.startsWith("lc_internal"))).toBe(false);
    s.client.setConsent({ analytics: true });
    expect(Object.keys(localStorage).some((k) => k.startsWith("lc_internal"))).toBe(true);
    s.client.capture("x");
    await s.client.flush();
    expect(s.t.events().find((e) => e.event === "x")!.properties.$internal).toBe(true);
    await s.client.shutdown();
    const again = start({ persistence: "localStorage" }); // a later page load
    live = again.client;
    expect(again.client.isInternal).toBe(true);
    again.client.optOutInternal(false);
    expect(again.client.isInternal).toBe(false);
    localStorage.clear();
  });

  it("is not set by default", async () => {
    const s = start();
    live = s.client;
    s.client.capture("x");
    await s.client.flush();
    expect(s.t.events()[0]!.properties).not.toHaveProperty("$internal");
    expect(names(s)).toBeTruthy();
  });
});

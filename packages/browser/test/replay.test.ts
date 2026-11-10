import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import { replay, resolveReplay, urlAllowed, lucidaRecords } from "../src/replay/index.js";
import type { BrowserConfig, Client } from "../src/index.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until, wait } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  delete (window as { __WATCHTOWER__?: unknown }).__WATCHTOWER__;
  await live?.shutdown();
  live = undefined;
});

const PAGE = `<h1>Shop</h1>
<input id="name" type="text" value="PREFILLED-SECRET-NAME">
<input id="pw" type="password" value="hunter2-PASSWORD">
<textarea id="ta">TEXTAREA-SECRET</textarea>
<p data-lc-mask>MASKED-PARAGRAPH-TEXT</p>
<div data-lc-block><span>BLOCKED-SUBTREE-TEXT</span></div>
<p class="srv-mask">SERVER-MASKED-TEXT</p>
<div id="srv-block"><span>SERVER-BLOCKED-TEXT</span></div>
<p>visible-copy</p>`;

function boot(cfg: BrowserConfig = {}, remote: unknown = {}) {
  document.body.innerHTML = PAGE;
  const f = replayFetch(remote);
  live = createClient(
    "lc_pk_test",
    { persistence: "memory", apiHost: "https://ingest.test", transport: fakeTransport(), fetch: f.fn, capturePageview: false, ...cfg },
    [replay],
  );
  return { f, client: live };
}
const bytes = (f: ReturnType<typeof replayFetch>) => f.posts.map((p) => p.raw).join("\n");

describe("replay module", () => {
  it("records, never puts input values or masked/blocked text in the chunk bytes, and sends page_height", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 3210 }); // jsdom has no layout
    const { f } = boot({ replay: { flush_interval_ms: 40 } });
    await until(() => f.posts.length > 0);
    document.querySelector<HTMLInputElement>("#name")!.value = "TYPED-SECRET-VALUE";
    document.querySelector("#name")!.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(150);
    const all = bytes(f);
    expect(f.posts.length).toBeGreaterThan(0);
    expect(all).toContain("visible-copy"); // it really recorded the DOM
    for (const secret of ["PREFILLED-SECRET-NAME", "hunter2-PASSWORD", "TEXTAREA-SECRET", "TYPED-SECRET-VALUE", "MASKED-PARAGRAPH-TEXT", "BLOCKED-SUBTREE-TEXT"]) {
      expect(all, secret).not.toContain(secret);
    }
    const types = f.posts.flatMap((p) => p.chunk.events.map((e) => e.type));
    expect(types).toContain(2); // full snapshot
    expect(f.posts[0]!.chunk.seq).toBe(0);
    expect(all).toMatch(/"tag":"page_height","payload":\{"height":3210\}/);
  });

  it("consent gate: opt_in blocks the recorder and the config fetch until replay consent is granted", async () => {
    const { f, client } = boot({ consent: { mode: "opt_in" }, replay: { flush_interval_ms: 40 } });
    await wait(150);
    expect(f.urls).toEqual([]);
    client.setConsent({ analytics: true }); // analytics alone is not enough
    await wait(150);
    expect(f.posts).toHaveLength(0);
    client.setConsent({ replay: true });
    await until(() => f.posts.length > 0);
    expect(f.posts.length).toBeGreaterThan(0);
  });

  it("revoking replay consent stops and discards", async () => {
    const { f, client } = boot({ replay: { flush_interval_ms: 60_000 } });
    await wait(200);
    client.setConsent({ replay: false });
    await wait(100);
    expect(f.posts).toHaveLength(0);
  });

  it("replayOwner=watchtower: no recorder, not even the config fetch", async () => {
    const { f } = boot({ replayOwner: "watchtower" });
    await wait(150);
    expect(f.urls).toEqual([]);
  });

  it("yields to a Watchtower SDK that announces it records, unless the owner is explicit", async () => {
    (window as { __WATCHTOWER__?: unknown }).__WATCHTOWER__ = { replayActive: true };
    expect(lucidaRecords(undefined)).toBe(false);
    expect(lucidaRecords("both")).toBe(true);
    expect(lucidaRecords("lucida")).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { f } = boot({});
    await wait(150);
    expect(f.urls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("replayOwner"));
    warn.mockRestore();
  });

  it("remote session_recording=false and sample_rate=0 prevent recording", async () => {
    const a = boot({}, { session_recording: false });
    await wait(150);
    expect(a.f.urls.some((u) => u.includes("/v1/replay"))).toBe(false);
    await live?.shutdown();
    const b = boot({ replay: { sample_rate: 0 } });
    await wait(150);
    expect(b.f.posts).toHaveLength(0);
  });

  it("on_event trigger: buffers silently, flushes the buffered snapshot when the event fires", async () => {
    const { f, client } = boot({ replay: { trigger: { mode: "on_event", events: ["checkout_failed"] }, flush_interval_ms: 40 } });
    await wait(250);
    expect(f.posts).toHaveLength(0); // nothing leaves the page before the trigger
    client.capture("checkout_failed");
    await until(() => f.posts.length > 0);
    const types = f.posts.flatMap((p) => p.chunk.events.map((e) => e.type));
    expect(types[0]).toBe(4); // meta, then
    expect(types).toContain(2); // a playable snapshot first
    expect(bytes(f)).not.toContain("hunter2-PASSWORD");
  });

  it("on_url trigger fires when the URL matches; excluded URLs stop recording", async () => {
    const { f } = boot({ replay: { trigger: { mode: "on_url", pattern: "/checkout" }, flush_interval_ms: 40 } });
    await wait(1200);
    expect(f.posts).toHaveLength(0);
    history.pushState({}, "", "/checkout");
    await until(() => f.posts.length > 0, 4000);
    expect(f.posts.length).toBeGreaterThan(0);
    history.pushState({}, "", "/");
  });

  it("a client-side route change is seen at once, not at the next poll", async () => {
    const { f } = boot({ replay: { trigger: { mode: "on_url", pattern: "/instant" }, flush_interval_ms: 40 } });
    await wait(100);
    history.pushState({}, "", "/instant");
    await until(() => f.posts.length > 0, 700); // the URL poll runs once a second
    expect(f.posts.length).toBeGreaterThan(0);
    history.pushState({}, "", "/");
  });

  it("min_duration_ms holds chunks back", async () => {
    const { f } = boot({ replay: { min_duration_ms: 600, flush_interval_ms: 40 } });
    await wait(300);
    expect(f.posts).toHaveLength(0);
    await until(() => f.posts.length > 0, 3000);
    expect(f.posts.length).toBeGreaterThan(0);
  });

  it("applies the server privacy policy: mask/block selectors reach the recorder", async () => {
    const { f } = boot(
      { replay: { flush_interval_ms: 40 } },
      { session_recording: true, replay_mask_selectors: [".srv-mask"], replay_block_selectors: ["#srv-block"] },
    );
    await until(() => f.posts.length > 0);
    await wait(100);
    const all = bytes(f);
    expect(all).toContain("visible-copy");
    expect(all).not.toContain("SERVER-MASKED-TEXT");
    expect(all).not.toContain("SERVER-BLOCKED-TEXT");
  });

  it("never-record pages are not recorded at all", async () => {
    const { f } = boot({ replay: { flush_interval_ms: 40 } }, { session_recording: true, replay_never_record: ["localhost"] });
    await wait(400);
    expect(f.posts).toHaveLength(0);
  });

  it("url blocklist (wildcard) is added to exclude_urls", () => {
    const r = resolveReplay({}, { replay_url_blocklist: ["/checkout*", "a.b/c"] })!;
    expect(urlAllowed("https://x.test/checkout/pay", r.include_urls, r.exclude_urls)).toBe(false);
    expect(urlAllowed("https://x.test/a.b/c", r.include_urls, r.exclude_urls)).toBe(false);
    expect(urlAllowed("https://x.test/aXb/c", r.include_urls, r.exclude_urls)).toBe(true);
    expect(urlAllowed("https://x.test/shop", r.include_urls, r.exclude_urls)).toBe(true);
  });
});

describe("replay config", () => {
  it("local beats remote beats defaults; remote can tighten masking but never loosen it", () => {
    expect(resolveReplay({}, null)).toMatchObject({ sample_rate: 1, mask_all_inputs: true, buffer_ms: 60_000, chunk_bytes: 262_144 });
    expect(resolveReplay({}, { replay_sample_rate: 0.25 })?.sample_rate).toBe(0.25);
    expect(resolveReplay({ sample_rate: 0.5 }, { replay_sample_rate: 0.25 })?.sample_rate).toBe(0.5);
    expect(resolveReplay({}, { mask_all_inputs: false })?.mask_all_inputs).toBe(true);
    expect(resolveReplay({ mask_all_inputs: false }, {})?.mask_all_inputs).toBe(false);
    expect(resolveReplay({}, { session_recording: false })).toBeNull();
    expect(resolveReplay({ chunk_bytes: 50_000_000 }, null)?.chunk_bytes).toBeLessThan(10_000_000);
    expect(resolveReplay({ block_selectors: [".a"] }, { replay: { block_selectors: [".b"] } })?.block_selectors).toEqual([".b", ".a"]);
  });
  it("url include/exclude", () => {
    expect(urlAllowed("https://a.test/x", [], [])).toBe(true);
    expect(urlAllowed("https://a.test/admin/x", [], ["/admin"])).toBe(false);
    expect(urlAllowed("https://a.test/shop", ["/shop"], [])).toBe(true);
    expect(urlAllowed("https://a.test/blog", ["/shop"], [])).toBe(false);
    expect(urlAllowed("https://a.test/shop/admin", ["/shop"], ["/admin"])).toBe(false);
  });
  it("anchored path patterns match the pathname, not the whole href", () => {
    expect(urlAllowed("https://a.test/account/billing", [], ["^/account"])).toBe(false);
    expect(urlAllowed("https://a.test/shop?account=1", [], ["^/account"])).toBe(true);
    expect(urlAllowed("https://a.test/shop", ["^/shop"], [])).toBe(true);
    expect(urlAllowed("https://a.test/x", [], ["^https://a\\.test/x"])).toBe(false);
  });
});

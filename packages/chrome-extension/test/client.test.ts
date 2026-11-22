import { describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";
import { connect } from "../src/page.js";
import { browserInfo } from "../src/adapters.js";
import { fakeChrome, recorder } from "./fake-chrome.js";

const noFlags = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;

describe("background client", () => {
  it("records install and update (from listeners registered before hydration), with extension props", async () => {
    const f = fakeChrome("1.3.0");
    const r = recorder();
    const p = createClient("lc_pk_x", { chrome: f.chrome, transport: r.transport, fetch: noFlags });
    f.fireInstalled({ reason: "install" }); // Chrome delivers it in the worker's first turn
    f.fireInstalled({ reason: "update", previousVersion: "1.2.0" });
    f.fireInstalled({ reason: "chrome_update" });
    const c = await p;
    await c.flush();
    const ev = r.events();
    expect(ev.map((e) => e.event)).toEqual(["$extension_installed", "$extension_updated"]);
    expect(ev[1]!.properties).toMatchObject({ $previous_version: "1.2.0", $extension_version: "1.3.0", $app_version: "1.3.0", $extension_id: "abcdefghijklmnop", $os: "Mac OS X", $lib: "lucida-chrome-extension" });
  });

  it("keeps the identity across worker restarts (chrome.storage.local)", async () => {
    const f = fakeChrome();
    const a = await createClient("lc_pk_x", { chrome: f.chrome, transport: recorder().transport, fetch: noFlags });
    a.identify("user-7");
    await new Promise((r) => setTimeout(r, 0));
    const b = await createClient("lc_pk_x", { chrome: fakeChrome("1.2.0", f.data).chrome, transport: recorder().transport, fetch: noFlags });
    expect(b.distinctId).toBe("user-7");
  });

  it("sets an uninstall URL that records $extension_uninstalled, and follows identify", async () => {
    const f = fakeChrome();
    const c = await createClient("lc_pk_x", { chrome: f.chrome, transport: recorder().transport, fetch: noFlags });
    const u = new URL(f.uninstallUrls.at(-1)!);
    expect(u.origin + u.pathname).toBe("https://capture.lucidace.com/v1/p.gif");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ k: "lc_pk_x", e: "$extension_uninstalled", fmt: "html", d: c.distinctId, "p.$extension_version": "1.2.0" });
    c.identify("user-7");
    expect(new URL(f.uninstallUrls.at(-1)!).searchParams.get("d")).toBe("user-7");
    c.optOut();
    expect(f.uninstallUrls.at(-1)).toBe("");
  });

  it("uses your own uninstall page with the id appended", async () => {
    const f = fakeChrome();
    const c = await createClient("lc_pk_x", { chrome: f.chrome, transport: recorder().transport, fetch: noFlags, uninstall: "https://example.com/bye?x=1" });
    const u = new URL(f.uninstallUrls.at(-1)!);
    expect(u.host).toBe("example.com");
    expect(u.searchParams.get("x")).toBe("1");
    expect(u.searchParams.get("lucida_distinct_id")).toBe(c.distinctId);
  });
});

describe("pages and content scripts", () => {
  it("send through the background client; nothing about the tab by default", async () => {
    const f = fakeChrome();
    const r = recorder();
    const bg = await createClient("lc_pk_x", { chrome: f.chrome, transport: r.transport, fetch: noFlags });
    const page = connect({ chrome: f.chrome });
    page.capture("highlight_saved", { words: 3 });
    expect(await page.distinctId()).toBe(bg.distinctId);
    await page.flush();
    const e = r.events().find((x) => x.event === "highlight_saved")!;
    expect(e.properties).toMatchObject({ words: 3, $extension_context: "content_script" });
    expect(e.properties.$host).toBeUndefined();
    expect(e.properties.$current_url).toBeUndefined();
  });

  it("adds the tab host only when asked", async () => {
    const f = fakeChrome();
    const r = recorder();
    await createClient("lc_pk_x", { chrome: f.chrome, transport: r.transport, fetch: noFlags, tabUrl: "host" });
    const page = connect({ chrome: f.chrome });
    page.capture("clip");
    await page.flush();
    const e = r.events().find((x) => x.event === "clip")!;
    expect(e.properties.$host).toBe("shop.test");
    expect(e.properties.$current_url).toBeUndefined();
  });

  it("leaves the extension's own messages alone", () => {
    const f = fakeChrome();
    void createClient("lc_pk_x", { chrome: f.chrome, transport: recorder().transport, fetch: noFlags });
    expect(f.listeners[0]!({ type: "app" }, {}, () => undefined)).toBeUndefined();
  });
});

it("reads the browser from client hints", () => {
  expect(browserInfo({ userAgentData: { brands: [{ brand: "Not)A;Brand", version: "99" }, { brand: "Chromium", version: "142" }, { brand: "Google Chrome", version: "142" }] } })).toEqual({ $browser: "Chrome", $browser_version: "142" });
  expect(browserInfo({ userAgent: "Mozilla/5.0 (X11; rv:140.0) Gecko/20100101 Firefox/140.0" })).toEqual({ $browser: "Firefox", $browser_version: "140" });
});

it("works without the storage permission (memory only, with a warning)", async () => {
  const f = fakeChrome();
  delete (f.chrome as { storage?: unknown }).storage;
  const r = recorder();
  const c = await createClient("lc_pk_x", { chrome: f.chrome, transport: r.transport, fetch: noFlags });
  c.capture("x");
  await c.flush();
  expect(r.events().map((e) => e.event)).toContain("x");
});

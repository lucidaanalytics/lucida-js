import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import { replay, resolveReplay } from "../src/replay/index.js";
import { guardIframeMessages } from "../src/replay/iframes.js";
import type { Client } from "../src/index.js";
import type { ReplayConfig } from "../src/replay/index.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until } from "./replay-helpers.js";

type Opts = Record<string, unknown> & { emit: (e: unknown) => void };
const calls: Opts[] = [];
vi.mock("@rrweb/record", () => {
  const record = Object.assign(
    (o: Opts) => {
      calls.push(o);
      return () => undefined;
    },
    { addCustomEvent: () => undefined, takeFullSnapshot: () => undefined },
  );
  return { record };
});

const parentDesc = Object.getOwnPropertyDescriptor(window, "parent");
let live: Client | undefined;
afterEach(async () => {
  calls.length = 0;
  await live?.shutdown();
  live = undefined;
  if (parentDesc) Object.defineProperty(window, "parent", parentDesc);
  Reflect.deleteProperty(document, "referrer");
});

async function boot(cfg: ReplayConfig): Promise<Opts> {
  const f = replayFetch({});
  live = createClient(
    "lc_pk_test",
    { persistence: "memory", apiHost: "https://ingest.test", transport: fakeTransport(), fetch: f.fn, capturePageview: false, replay: cfg },
    [replay],
  );
  await until(() => calls.length > 0, 1500);
  return calls[0] as Opts;
}
const post = (origin: string, data: unknown): void => void window.dispatchEvent(new MessageEvent("message", { origin, data }));

describe("canvas capture (LC-EXP-23)", () => {
  it("is off by default", async () => {
    const o = await boot({});
    expect(o.recordCanvas).toBe(false);
    expect(o.recordCrossOriginIframes).toBe(false);
  });
  it("opt-in passes fps and quality, clamped; data-lc-block stays the block selector", async () => {
    const o = await boot({ captureCanvas: { fps: 99, quality: 0.6 } });
    expect(o.recordCanvas).toBe(true);
    expect((o.sampling as { canvas: number }).canvas).toBe(15);
    expect(o.dataURLOptions).toEqual({ type: "image/jpeg", quality: 0.6 });
    expect(String(o.blockSelector)).toContain("[data-lc-block]");
  });
  it("remote config cannot switch it on", () => {
    expect(resolveReplay({}, { replay: { captureCanvas: { fps: 5 } } } as never)?.canvas).toBeNull();
  });
  it("mask regions hand canvas capture from rrweb to the masking sampler (LC-EXP-59)", async () => {
    const o = await boot({ captureCanvas: { fps: 2 }, canvasMaskRegions: () => [] });
    expect(o.recordCanvas).toBe(false);
    expect((o.sampling as { canvas?: number }).canvas).toBeUndefined();
    expect(o.dataURLOptions).toBeUndefined();
  });
});

describe("replay diagnostics (LC-EXP-61) and assets (LC-EXP-64)", () => {
  it("swallows rrweb observer errors and stamps the count and last message on events", async () => {
    const t = fakeTransport();
    live = createClient(
      "lc_pk_test",
      { persistence: "memory", apiHost: "https://ingest.test", transport: t, fetch: replayFetch({}).fn, capturePageview: false, replay: {} },
      [replay],
    );
    await until(() => calls.length > 0, 1500);
    expect((calls[0]!.errorHandler as (e: unknown) => boolean)(new Error("observer boom"))).toBe(true);
    live.capture("x");
    await live.flush();
    const p = t.events().find((e) => e.event === "x")!.properties;
    expect(p).toMatchObject({ $recording_status: "active", $replay_rrweb_error_count: 1 });
    expect(String(p.$replay_rrweb_error)).toContain("observer boom");
  });
  it("passes inlineImages / collectFonts only when opted in", async () => {
    const off = await boot({});
    expect(off.inlineImages).toBeUndefined();
    calls.length = 0;
    await live?.shutdown();
    const on = await boot({ assets: { inlineImages: true, collectFonts: true } });
    expect(on).toMatchObject({ inlineImages: true, collectFonts: true });
  });
});

describe("cross-origin iframes (LC-EXP-24)", () => {
  it("parent: rrweb messages from non-allowlisted origins never reach later listeners; allowed ones do", () => {
    const seen: string[] = [];
    const stop = guardIframeMessages(["https://child.test"]);
    const later = (e: MessageEvent): void => void seen.push(e.origin);
    window.addEventListener("message", later);
    post("https://evil.test", { type: "rrweb", origin: "https://evil.test" });
    post("https://child.test", { type: "rrweb", origin: "https://child.test" });
    post("https://evil.test", { type: "other" }); // not rrweb: untouched
    window.removeEventListener("message", later);
    stop();
    expect(seen).toEqual(["https://child.test", "https://evil.test"]);
  });
  it("parent: enables recordCrossOriginIframes only when an allowlist is set", async () => {
    const o = await boot({ crossOriginIframes: { allowedOrigins: ["https://child.test"] } });
    expect(o.recordCrossOriginIframes).toBe(true);
  });
  it("child frame: records only when the embedding origin is allowlisted", async () => {
    Object.defineProperty(window, "parent", { configurable: true, value: {} }); // simulated parent window
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://evil.test/page" });
    await boot({ crossOriginIframes: { allowedOrigins: ["https://parent.test"] } });
    expect(calls).toHaveLength(0);
    await live?.shutdown();
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://parent.test/shop" });
    const o = await boot({ crossOriginIframes: { allowedOrigins: ["https://parent.test"] } });
    expect(o.recordCrossOriginIframes).toBe(true);
  });
});

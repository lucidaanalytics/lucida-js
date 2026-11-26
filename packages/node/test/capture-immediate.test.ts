import { afterEach, describe, expect, it, vi } from "vitest";
import { captureImmediate } from "../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
const ev = { event: "e", distinctId: "d", properties: { a: 1 }, $set: { p: 1 } };

describe("captureImmediate", () => {
  it("posts one event to /v1/batch with the env key and host", async () => {
    vi.stubEnv("LUCIDA_SECRET_KEY", "k");
    vi.stubEnv("LUCIDA_HOST", "https://h.test/");
    const f = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await captureImmediate(ev)).toEqual({ ok: true, status: 200 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://h.test/v1/batch");
    const b = JSON.parse(init.body as string);
    expect(b.api_key).toBe("k");
    expect(b.batch[0]).toMatchObject({ event: "e", distinct_id: "d", $set: { p: 1 }, properties: { a: 1 } });
    expect(b.batch[0].uuid).toBeTruthy();
  });
  it("reports non-2xx without throwing", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    expect(await captureImmediate(ev, { apiKey: "k" })).toMatchObject({ ok: false, status: 503 });
  });
  it("no key: ok false and no request", async () => {
    vi.stubEnv("LUCIDA_SECRET_KEY", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await captureImmediate(ev)).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("times out after 5 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_u: string, i: RequestInit) => new Promise((_r, rej) => i.signal!.addEventListener("abort", () => rej(new Error("aborted")))));
    const p = captureImmediate(ev, { apiKey: "k" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: false, error: "timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("network error resolves ok false", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("boom"); });
    expect(await captureImmediate(ev, { apiKey: "k" })).toEqual({ ok: false, error: "boom" });
  });
  it("consentFromCookies: granted stamps the event and person, denied sends nothing", async () => {
    const f = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await captureImmediate(ev, { apiKey: "k", consentFromCookies: { get: (n) => (n === "lc_consent" ? { value: "granted" } : undefined) } });
    const b = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(b.batch[0].properties.$consent_analytics).toBe("granted");
    expect(b.batch[0].$set).toEqual({ p: 1, $consent_analytics: "granted" });
    expect(await captureImmediate(ev, { apiKey: "k", consentFromCookies: "x=1; lc_consent=denied" })).toEqual({ ok: false, error: "consent denied" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("falls back to LUCIDA_KEY, and new Lucida() reads the env key", async () => {
    vi.stubEnv("LUCIDA_SECRET_KEY", "");
    vi.stubEnv("LUCIDA_KEY", "old");
    const f = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await captureImmediate(ev);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).api_key).toBe("old");
    vi.stubEnv("LUCIDA_SECRET_KEY", "new");
    const { Lucida } = await import("../src/index.js");
    const c = new Lucida(undefined, { testMode: { fixture: { flags: [] } } as never });
    expect((c as unknown as { apiKey: string }).apiKey).toBe("new");
    await c.shutdown();
  });
});

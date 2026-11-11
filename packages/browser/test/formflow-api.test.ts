import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, init } from "../src/index.js";
import { stampSession } from "../src/watchtower/correlate.js";
import { fakeTransport } from "./helpers.js";

const base = { apiHost: "https://ingest.test", capturePageview: false, autocapture: false, persistence: "memory" } as const;
const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.lucida;
  delete g.watchtower;
  vi.restoreAllMocks();
});

describe("exposeGlobal", () => {
  it("is off by default", () => {
    init("lc_pk_g0", { ...base, transport: fakeTransport() });
    expect(g.lucida).toBeUndefined();
  });

  it("sets globalThis.lucida to the client and fires lucida:ready", () => {
    const ready = vi.fn();
    window.addEventListener("lucida:ready", ready, { once: true });
    const c = init("lc_pk_g1", { ...base, transport: fakeTransport(), exposeGlobal: true });
    expect(g.lucida).toBe(c);
    expect((g.lucida as typeof c).getSessionId()).toBe(c.getSessionId());
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("accepts a custom name", () => {
    const c = createClient("lc_pk_g2", { ...base, transport: fakeTransport(), exposeGlobal: "lc" });
    expect(g.lc).toBe(c);
    expect(g.lucida).toBeUndefined();
    delete g.lc;
  });
});

describe("consent and ids", () => {
  it("hasOptedOut / hasOptedIn / consentStatus follow the explicit choice, onConsent fires", () => {
    const c = init("lc_pk_c1", { ...base, transport: fakeTransport(), consent: { mode: "opt_in" } });
    const seen: string[] = [];
    const off = c.onConsent(() => seen.push(c.consentStatus()));
    expect([c.consentStatus(), c.hasOptedOut(), c.hasOptedIn()]).toEqual(["pending", false, false]);
    c.optIn();
    expect([c.consentStatus(), c.hasOptedOut(), c.hasOptedIn()]).toEqual(["granted", false, true]);
    c.optOut();
    expect([c.consentStatus(), c.hasOptedOut(), c.hasOptedIn()]).toEqual(["denied", true, false]);
    off();
    c.optIn();
    expect(seen).toEqual(["granted", "denied"]);
  });

  it("getDistinctId equals distinctId", () => {
    const c = init("lc_pk_d1", { ...base, transport: fakeTransport() });
    expect(c.getDistinctId()).toBe(c.distinctId);
    c.identify("user-1");
    expect(c.getDistinctId()).toBe("user-1");
  });
});

describe("Watchtower session stamp", () => {
  const attrs = () => {
    const calls: Array<[string, unknown]> = [];
    return { calls, setAttribute: (k: string, v: unknown) => void calls.push([k, v]) };
  };

  it("stamps lucida.session_id on a client passed in the option, and again on rotation", () => {
    const wt = attrs();
    const c = init("lc_pk_w1", { ...base, transport: fakeTransport(), session: { idleMs: 60_000 }, consent: { mode: "opt_in" }, watchtower: { client: wt as never } });
    c.optIn();
    expect(wt.calls).toContainEqual(["lucida.session_id", c.getSessionId()]);
    const first = c.getSessionId();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61_000);
    const second = c.getSessionId();
    vi.useRealTimers();
    expect(second).not.toBe(first);
    expect(wt.calls.at(-1)).toEqual(["lucida.session_id", second]);
  });

  it("reads globalThis.watchtower", () => {
    const wt = attrs();
    g.watchtower = wt;
    const c = init("lc_pk_w2", { ...base, transport: fakeTransport(), consent: { mode: "opt_in" } });
    c.optIn();
    expect(wt.calls).toContainEqual(["lucida.session_id", c.getSessionId()]);
  });

  it("waits for consent and does nothing without a Watchtower client", () => {
    const wt = attrs();
    const c = init("lc_pk_w3", { ...base, transport: fakeTransport(), consent: { mode: "opt_in" }, watchtower: { client: wt as never } });
    expect(wt.calls).toEqual([]);
    c.optIn();
    expect(wt.calls).toContainEqual(["lucida.session_id", c.getSessionId()]);
    expect(stampSession({ config: {}, core: {} } as never)).toBeUndefined();
  });
});

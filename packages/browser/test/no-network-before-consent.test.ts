import { describe, expect, it, vi } from "vitest";
import { init } from "../src/index.js";
import { fakeFetch, fakeTransport, tick } from "./helpers.js";

describe("opt_in: nothing leaves the page before consent", () => {
  it("makes no fetch and writes no storage until consent is granted, then loads flags", async () => {
    localStorage.clear();
    document.cookie.split(";").forEach((c) => (document.cookie = `${c.split("=")[0]}=; max-age=0`));
    const f = fakeFetch();
    const t = fakeTransport();
    const c = init("lc_pk_optin", { apiHost: "https://ingest.test", persistence: "localStorage", transport: t, fetch: f.fn, consent: { mode: "opt_in" }, capturePageview: false, autocapture: false });
    c.capture("early");
    await tick(30);
    await c.flush();
    expect(f.calls).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(localStorage.length).toBe(0);
    c.setConsent({ analytics: true });
    await vi.waitFor(() => expect(f.calls.some((x) => x.url.includes("/v1/flags"))).toBe(true));
    await c.shutdown();
  });
});

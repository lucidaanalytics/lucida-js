// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createClient, init } from "../src/index.js";

describe("init on the server", () => {
  it("returns a silent no-op client of the same shape", async () => {
    const warn = vi.spyOn(console, "warn");
    const debug = vi.spyOn(console, "debug");
    const c = init("lc_pk_ssr");
    expect(c.getSessionId()).toBeUndefined();
    expect(c.getDistinctId()).toBeUndefined();
    expect(c.capture("x", { a: 1 })).toBeUndefined();
    c.identify("u");
    c.replay.start();
    c.guides.show("g");
    expect(c.hasOptedOut()).toBe(false);
    expect(c.hasOptedIn()).toBe(false);
    expect(c.consentStatus()).toBe("pending");
    expect(c.getAllFlags()).toEqual({});
    expect(c.getFlagResult("k").reason).toBe("not_found");
    expect(c.onSessionId(() => {})).toBeTypeOf("function");
    await c.flush();
    await c.shutdown();
    expect(await Promise.resolve(c)).toBe(c); // not a thenable
    expect(createClient("lc_pk_ssr2")).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });
});

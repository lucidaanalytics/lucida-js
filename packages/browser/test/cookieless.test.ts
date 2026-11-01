import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "../src/index.js";
import { fakeFetch, fakeTransport, tick } from "./helpers.js";

describe("persistence: 'none' (cookie-free, G34)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes no cookie or storage and omits distinct_id until identify", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookie = vi.spyOn(document, "cookie", "set");
    const t = fakeTransport();
    const client = init("lc_pk_test", {
      persistence: "none",
      apiHost: "https://ingest.test",
      transport: t,
      fetch: fakeFetch({ "/v1/flags": { flags: {} } }).fn,
      capturePageview: false,
      autocapture: false,
    });
    client.capture("a");
    client.register({ k: 1 });
    await client.flush();
    expect(client.distinctId).toBe("");
    expect(t.events()[0]).not.toHaveProperty("distinct_id");
    client.identify("user-1");
    client.capture("b");
    await client.flush();
    const ev = t.events();
    expect(ev.find((e) => e.event === "b")!.distinct_id).toBe("user-1");
    const idf = ev.find((e) => e.event === "$identify")!;
    expect(idf.distinct_id).toBe("user-1");
    expect(idf.properties).not.toHaveProperty("$anon_distinct_id");
    await tick(5);
    expect(setItem).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
    expect(sessionStorage.length + localStorage.length).toBe(0);
  });
});

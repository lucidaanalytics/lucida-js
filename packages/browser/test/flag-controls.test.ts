import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  vi.useRealTimers();
});

const base = { capturePageview: false, autocapture: false } as const;
const ok = { "/v1/flags": { flags: { a: true, b: "x", c: false } } };

describe("flag controls", () => {
  it("updateFlags merges by default and replaces with merge:false; bootstrap carries payloads", () => {
    const { client } = start({ ...base, bootstrap: { flags: { a: true }, payloads: { a: { n: 1 } } }, flagOptions: { disableRemote: true } });
    live = client;
    expect(client.getFlag("a")).toBe(true);
    expect(client.getFlagPayload("a")).toEqual({ n: 1 });
    client.updateFlags({ b: "v" }, { b: 2 });
    expect([client.getFlag("a"), client.getFlag("b"), client.getFlagPayload("b"), client.getFlagPayload("a")]).toEqual([true, "v", 2, { n: 1 }]);
    client.updateFlags({ z: true }, undefined, { merge: false });
    expect([client.getFlag("a"), client.getFlag("z")]).toEqual([undefined, true]);
  });

  it("onFlags fires on updateFlags", () => {
    const { client } = start({ ...base, flagOptions: { disableRemote: true } });
    live = client;
    const seen: unknown[] = [];
    client.onFlags((f) => seen.push(f));
    client.updateFlags({ q: true });
    expect(seen).toEqual([{ q: true }]);
  });

  it("disableRemote never calls /v1/flags", async () => {
    const { client, f } = start({ ...base, _h: ok, flagOptions: { disableRemote: true } } as never);
    live = client;
    await client.reloadFlags();
    expect(f.calls).toEqual([]);
  });

  it("keys scope the request and the exposed flags; evaluationContexts are sent", async () => {
    const { client, f } = start({ ...base, _h: ok, flagOptions: { keys: ["a"], evaluationContexts: ["web"] } } as never);
    live = client;
    await vi.waitFor(() => expect(client.getFlag("a")).toBe(true));
    expect(client.getFlag("b")).toBeUndefined();
    const body = JSON.parse(f.calls[0]!.init!.body as string);
    expect(body).toMatchObject({ flag_keys: ["a"], app_contexts: ["web"] });
  });

  it("flagsApiHost serves the flags request", async () => {
    const { client, f } = start({ ...base, _h: ok, flagsApiHost: "https://flags.test/" } as never);
    live = client;
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    expect(f.calls[0]!.url).toBe("https://flags.test/v1/flags");
  });

  it("aborts a slow request after timeoutMs and keeps current flags", async () => {
    const aborted = vi.fn();
    const slow = ((_u: string, init?: RequestInit) =>
      new Promise((_r, rej) => init!.signal!.addEventListener("abort", () => (aborted(), rej(new DOMException("a", "AbortError")))))) as unknown as typeof fetch;
    const { client } = start({ ...base, fetch: slow, bootstrap: { flags: { a: true } }, flagOptions: { timeoutMs: 10 } });
    live = client;
    await client.reloadFlags();
    expect(aborted).toHaveBeenCalled();
    expect(client.getFlag("a")).toBe(true);
  });

  it("refreshMs refetches on an interval and stops at shutdown", async () => {
    const { client, f } = start({ ...base, _h: ok, flagOptions: { refreshMs: 20 } } as never);
    await vi.waitFor(() => expect(f.calls.length).toBeGreaterThanOrEqual(3));
    const clear = vi.spyOn(globalThis, "clearInterval");
    await client.shutdown();
    expect(clear).toHaveBeenCalled();
  });
});

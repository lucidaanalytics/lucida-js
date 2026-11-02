import { describe, expect, it } from "vitest";
import type { Client } from "@lucida-analytics/browser";
import { createLucida } from "../src/index.js";

type FlagCb = (f: Record<string, boolean | string>) => void;

function fakeClient() {
  const calls: string[] = [];
  let cb: FlagCb = () => {};
  const client = {
    capture: (e: string) => calls.push(`capture:${e}`),
    getFlag: (k: string) => calls.push(`expose:${k}`),
    getFlagPayload: (k: string) => ({ k }),
    setConsent: (u: object) => calls.push(`consent:${JSON.stringify(u)}`),
    onFlags: (f: FlagCb) => ((cb = f), () => calls.push("unsub")),
  } as unknown as Client;
  return { client, calls, push: (f: Record<string, boolean | string>) => cb(f) };
}

describe("@lucida-analytics/svelte", () => {
  it("flag store starts from bootstrap, updates on reload, exposes only on a defined change", () => {
    const f = fakeClient();
    const l = createLucida({ client: f.client, bootstrapFlags: { beta: "b" } });
    const seen: unknown[] = [];
    const off = l.flag("beta").subscribe((v) => seen.push(v));
    expect(seen).toEqual(["b"]);
    expect(f.calls).toEqual(["expose:beta"]);
    f.push({ beta: "b", other: true }); // beta unchanged: no new emit, no new exposure
    f.push({ beta: false });
    expect(seen).toEqual(["b", false]);
    expect(f.calls.filter((c) => c === "expose:beta")).toHaveLength(2);
    off();
    f.push({ beta: "c" });
    expect(seen).toHaveLength(2);
  });

  it("payload store, capture and consent controls go through the client", () => {
    const f = fakeClient();
    const l = createLucida({ client: f.client });
    let payload: unknown;
    l.payload("x").subscribe((p) => (payload = p));
    expect(payload).toEqual({ k: "x" });
    l.capture("hit");
    l.consent.grant();
    l.consent.revoke();
    expect(f.calls).toEqual(["capture:hit", 'consent:{"analytics":true,"replay":true}', 'consent:{"analytics":false,"replay":false,"marketing":false}']);
    l.destroy();
    expect(f.calls.at(-1)).toBe("unsub");
  });

  it("is inert without client or apiKey", () => {
    const l = createLucida({ bootstrapFlags: { a: true } });
    expect(l.client).toBeNull();
    let v: unknown;
    l.flag("a").subscribe((x) => (v = x));
    expect(v).toBe(true);
    expect(() => (l.capture("x"), l.consent.grant())).not.toThrow();
  });

  it("creates a consent-aware client from apiKey (opt_in: nothing sent before grant)", async () => {
    const sent: string[] = [];
    const l = createLucida({
      apiKey: "lc_pk_svelte",
      options: {
        persistence: "memory",
        consent: { mode: "opt_in" },
        capturePageview: false,
        offlineQueue: false,
        transport: { send: async (_u: string, body: string) => (sent.push(...(JSON.parse(body) as { batch: { event: string }[] }).batch.map((e) => e.event)), { status: 200 }) },
        fetch: (async () => new Response("{}", { status: 404 })) as typeof fetch,
      },
    });
    l.capture("before");
    await l.client!.flush();
    expect(sent).toEqual([]);
    l.consent.grant();
    l.capture("after");
    await l.client!.flush();
    expect(sent).toContain("after");
    expect(sent).not.toContain("before");
    l.destroy();
    await l.client!.shutdown();
  });
});

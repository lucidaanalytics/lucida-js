import { describe, expect, it } from "vitest";
import { getProviderData, lucidaAdapter } from "../src/index.js";

const jsonFetch = (flags: Record<string, unknown>, calls: string[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${String(url)} ${init?.body ?? ""}`);
    return new Response(JSON.stringify({ flags }), { status: 200 });
  }) as typeof fetch;

const cookies = (m: Record<string, string> = {}) => ({ get: (n: string) => (m[n] ? { value: m[n] } : undefined) });
const headers = (m: Record<string, string> = {}) => new Headers(m);

describe("lucidaAdapter", () => {
  it("decides booleans, variants and raw values from one evaluation per request", async () => {
    const calls: string[] = [];
    const lucida = lucidaAdapter({ apiKey: "lc_pk_x", host: "https://lc.test", fetch: jsonFetch({ on: { enabled: true }, off: { enabled: false }, ab: { variant: "b" } }, calls) });
    const h = headers();
    const c = cookies({ lc_distinct_id: "visitor 1" });
    const decide = <V>(a: ReturnType<typeof lucida.isEnabled> | { decide: (p: never) => Promise<V> }, key: string, defaultValue?: unknown) =>
      (a as ReturnType<typeof lucida.isEnabled>).decide({ key, headers: h, cookies: c, defaultValue: defaultValue as boolean });
    expect(await decide(lucida.isEnabled(), "on")).toBe(true);
    expect(await decide(lucida.isEnabled(), "off")).toBe(false);
    expect(await decide(lucida.isEnabled(), "missing", true)).toBe(true);
    expect(await lucida.variant().decide({ key: "ab", headers: h, cookies: c })).toBe("b");
    expect(await lucida.variant().decide({ key: "off", headers: h, cookies: c, defaultValue: "control" })).toBe("control");
    expect(await lucida.value<string>().decide({ key: "ab", headers: h, cookies: c })).toBe("b");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("https://lc.test/v1/flags");
    expect(calls[0]).toContain('"distinct_id":"visitor 1"');
  });

  it("identifies the visitor from the cookie, the middleware header, or a fresh id", async () => {
    const lucida = lucidaAdapter({ apiKey: "lc_pk_x", fetch: jsonFetch({}), middleware: true });
    const a = lucida.isEnabled();
    expect(await a.identify({ headers: headers(), cookies: cookies({ lc_distinct_id: "abc" }) })).toEqual({ distinctId: "abc" });
    const forwarded = headers({ "x-lc-distinct-id": "fwd", "x-lc-flags": "{}" });
    expect(await a.identify({ headers: forwarded, cookies: cookies() })).toEqual({ distinctId: "fwd" });
    expect((await a.identify({ headers: headers(), cookies: cookies() })).distinctId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("links flags to the dashboard and never throws when flags are unavailable", async () => {
    const bad = lucidaAdapter({ apiKey: "lc_pk_x", host: "https://lc.test/", fetch: (async () => new Response("", { status: 500 })) as typeof fetch });
    const a = bad.isEnabled();
    expect(a.origin("new checkout")).toBe("https://lc.test/flags?q=new%20checkout");
    expect(await a.decide({ key: "k", headers: headers(), cookies: cookies() })).toBe(false);
  });
});

/** Seals overrides the way the Flags Explorer does: compact JWE, dir + A256GCM, payload { o }. */
async function seal(secretB64: string, o: Record<string, unknown>, exp?: number): Promise<string> {
  const enc = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const header = enc(new TextEncoder().encode(JSON.stringify({ alg: "dir", enc: "A256GCM" })));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", dec(secretB64) as BufferSource, "AES-GCM", false, ["encrypt"]);
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(header) }, key, new TextEncoder().encode(JSON.stringify({ o, ...(exp ? { exp } : {}) }))));
  return [header, "", enc(iv), enc(out.slice(0, -16)), enc(out.slice(-16))].join(".");
}

describe("Flags Explorer overrides", () => {
  const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const lucida = lucidaAdapter({ apiKey: "lc_pk_x", fetch: jsonFetch({ checkout: { enabled: false }, ab: { variant: "a" } }), flagsSecret: secret });

  it("applies the overrides of a teammate to that visitor only", async () => {
    const c = cookies({ lc_distinct_id: "v1", "vercel-flag-overrides": await seal(secret, { checkout: true, ab: "b" }) });
    expect(await lucida.isEnabled().decide({ key: "checkout", headers: headers(), cookies: c })).toBe(true);
    expect(await lucida.variant().decide({ key: "ab", headers: headers(), cookies: c })).toBe("b");
    const plain = cookies({ lc_distinct_id: "v2" });
    expect(await lucida.isEnabled().decide({ key: "checkout", headers: headers(), cookies: plain })).toBe(false);
  });

  it("ignores a cookie that was not sealed with the secret, was tampered with, or expired", async () => {
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(9))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const forged = await seal(other, { checkout: true });
    const good = await seal(secret, { checkout: true });
    const expired = await seal(secret, { checkout: true }, 1);
    for (const v of [forged, good.slice(0, -2) + "xx", expired, "garbage"]) {
      const c = cookies({ lc_distinct_id: "v1", "vercel-flag-overrides": v });
      expect(await lucida.isEnabled().decide({ key: "checkout", headers: headers(), cookies: c })).toBe(false);
    }
  });
});

describe("getProviderData", () => {
  it("lists flags with their options for the Flags Explorer", async () => {
    let seen: { url: string; auth: string | null } = { url: "", auth: null };
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), auth: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify({ data: [{ key: "ab", name: "AB", description: "Test", variants: [{ key: "a" }, { key: "b" }] }, { key: "plain", name: "Plain" }] }));
    }) as typeof fetch;
    const d = await getProviderData({ apiKey: "lc_sk_x", project: "p1", host: "https://lc.test", fetch: f });
    expect(seen).toEqual({ url: "https://lc.test/v1/projects/p1/flags?limit=200", auth: "Bearer lc_sk_x" });
    expect(d.definitions.ab).toMatchObject({ description: "Test", options: [{ value: "a" }, { value: "b" }] });
    expect(d.definitions.plain).toMatchObject({ description: "Plain", options: [{ value: false }, { value: true }] });
    const down = await getProviderData({ apiKey: "k", project: "p", fetch: (async () => new Response("", { status: 401 })) as typeof fetch });
    expect(down.definitions).toEqual({});
    expect(down.hints[0]).toContain("401");
  });
});

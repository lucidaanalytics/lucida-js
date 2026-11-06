import { describe, expect, it } from "vitest";
import { COOKIE_ID, getBootstrap, HEADER_FLAGS, HEADER_ID, lucidaMiddleware, lucidaRewrites, withLucida } from "../src/index.js";
import type { LucidaNextOptions, RequestLike, ResponseLike } from "../src/index.js";

const flagsFetch = (flags: Record<string, unknown>, seen: unknown[] = []) =>
  (async (_url: string, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ flags }), { status: 200 });
  }) as unknown as typeof fetch;

const opts = (over: Partial<LucidaNextOptions> = {}): LucidaNextOptions => ({
  apiKey: "lc_pk_x",
  host: "https://gw.test",
  fetch: flagsFetch({ "new-nav": { enabled: true, variant: "b", value: "b" }, beta: true }),
  ...over,
});

const req = (cookies: Record<string, string> = {}, headers: Record<string, string> = {}): RequestLike => ({
  headers: new Headers(headers),
  cookies: { get: (n) => (n in cookies ? { value: cookies[n] as string } : undefined) },
});
const res = () => {
  const set: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const r: ResponseLike & { set: typeof set } = { cookies: { set: (n, v, o) => void set.push([n, v, o]) }, set };
  return r;
};

describe("lucidaMiddleware", () => {
  it("evaluates flags once and forwards id + flags as request headers, overwriting client-sent ones", async () => {
    const seen: unknown[] = [];
    const lc = await lucidaMiddleware(req({ [COOKIE_ID]: "anon-1" }, { [HEADER_FLAGS]: '{"admin":true}' }), opts({ fetch: flagsFetch({ beta: true, nav: { value: "b" } }, seen) }));
    expect(lc.distinctId).toBe("anon-1");
    expect(lc.flags).toEqual({ beta: true, nav: "b" });
    expect(lc.requestHeaders.get(HEADER_ID)).toBe("anon-1");
    expect(JSON.parse(lc.requestHeaders.get(HEADER_FLAGS) ?? "")).toEqual({ beta: true, nav: "b" });
    expect(seen).toEqual([{ api_key: "lc_pk_x", distinct_id: "anon-1", groups: {}, person_properties: {} }]);
  });

  it("writes the distinct-id cookie only with consent (opt_in by default)", async () => {
    const without = res();
    (await lucidaMiddleware(req(), opts())).apply(without);
    expect(without.set).toEqual([]);

    const granted = res();
    const lc = await lucidaMiddleware(req({ lc_consent: "granted" }), opts());
    lc.apply(granted);
    expect(granted.set[0]?.slice(0, 2)).toEqual([COOKIE_ID, lc.distinctId]);
    expect(granted.set[0]?.[2]).toMatchObject({ sameSite: "lax", path: "/" });

    const known = res();
    (await lucidaMiddleware(req({ lc_consent: "granted", [COOKIE_ID]: "a" }), opts())).apply(known);
    expect(known.set).toEqual([]); // already stored

    const optOut = res();
    (await lucidaMiddleware(req({ lc_consent: "denied" }), opts({ consentMode: "opt_out" }))).apply(optOut);
    expect(optOut.set).toEqual([]);
    const optOutOk = res();
    (await lucidaMiddleware(req(), opts({ consentMode: "opt_out" }))).apply(optOutOk);
    expect(optOutOk.set).toHaveLength(1);
  });

  it("never blocks the page: a failing flags service yields no flags", async () => {
    const lc = await lucidaMiddleware(req(), opts({ fetch: (async () => new Response("", { status: 503 })) as unknown as typeof fetch }));
    expect(lc.flags).toEqual({});
    const boom = await lucidaMiddleware(req(), opts({ fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch }));
    expect(boom.flags).toEqual({});
  });

  it("uses a custom evaluator (local evaluation) instead of the remote call", async () => {
    const lc = await lucidaMiddleware(req(), opts({ evaluate: async (id) => ({ who: id.length > 0 }), fetch: (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch }));
    expect(lc.flags).toEqual({ who: true });
  });
});

describe("getBootstrap (App Router)", () => {
  it("trusts forwarded headers only when the middleware flag is set", async () => {
    const h = new Headers({ [HEADER_ID]: "mw-id", [HEADER_FLAGS]: '{"beta":"x"}' });
    expect(await getBootstrap(h, opts({ middleware: true }))).toEqual({ distinctId: "mw-id", flags: { beta: "x" } });
    const spoof = await getBootstrap(h, opts());
    expect(spoof.distinctId).not.toBe("mw-id");
    expect(spoof.flags).toMatchObject({ beta: true }); // evaluated, not taken from the header
  });
  it("falls back to the cookie id and evaluates", async () => {
    const seen: unknown[] = [];
    const b = await getBootstrap(new Headers({ cookie: `a=1; ${COOKIE_ID}=anon-9; b=2` }), opts({ fetch: flagsFetch({ beta: true }, seen) }));
    expect(b).toEqual({ distinctId: "anon-9", flags: { beta: true } });
    expect(seen[0]).toMatchObject({ distinct_id: "anon-9" });
  });
});

describe("Pages Router", () => {
  const ctx = { req: { headers: { cookie: `${COOKIE_ID}=anon-3` } as Record<string, string | string[] | undefined> } };
  it("adds the bootstrap to props and keeps the page's own props", async () => {
    const gssp = withLucida(async () => ({ props: { title: "Home" } }), opts());
    expect(await gssp(ctx)).toEqual({ props: { title: "Home", __lucida: { distinctId: "anon-3", flags: { "new-nav": "b", beta: true } } } });
  });
  it("passes redirects and not-found through untouched", async () => {
    expect(await withLucida(async () => ({ notFound: true as const }), opts())(ctx)).toEqual({ notFound: true });
    expect(await withLucida(async () => ({ redirect: { destination: "/x" } }), opts())(ctx)).toEqual({ redirect: { destination: "/x" } });
  });
  it("works without a page gssp", async () => {
    const out = await withLucida(undefined, opts())(ctx);
    expect("props" in out && (out.props as { __lucida: { distinctId: string } }).__lucida.distinctId).toBe("anon-3");
  });
});

describe("lucidaRewrites", () => {
  it("proxies only /v1 under a first-party path", () => {
    expect(lucidaRewrites()).toEqual([{ source: "/ingest/v1/:path*", destination: "https://capture.lucidace.com/v1/:path*" }]);
    expect(lucidaRewrites({ path: "t/", host: "https://eu.lucida.dev/" })).toEqual([{ source: "/t/v1/:path*", destination: "https://eu.lucida.dev/v1/:path*" }]);
  });
});

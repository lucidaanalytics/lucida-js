import { describe, expect, it } from "vitest";
import { InMemoryFlagDefinitionCache, Lucida, getContext, readTracingHeaders, withContext } from "../src/index.js";
import { LucidaInterceptor, fastifyRequestContext, setupRequestContext } from "../src/middleware.js";
import { fakeGateway, flag } from "./helpers.js";

const mk = (g: ReturnType<typeof fakeGateway>, o = {}) =>
  new Lucida("lc_pk_x", { host: "http://gw", fetch: g.fetch, flushAt: 100, ...o });

describe("context", () => {
  it("merges context, nests, and explicit args win", async () => {
    const g = fakeGateway();
    const l = mk(g);
    withContext({ distinctId: "u1", sessionId: "s1", properties: { a: 1, b: 1 } }, () => {
      withContext({ properties: { b: 2 } }, () => l.capture({ event: "inner" }));
      withContext({}, () => expect(getContext()?.distinctId).toBeUndefined(), { fresh: true });
      l.capture({ distinctId: "explicit", event: "outer", properties: { a: 9 } });
    });
    expect(getContext()).toBeUndefined();
    await l.shutdown();
    const [inner, outer] = g.events();
    expect(inner).toMatchObject({ distinct_id: "u1", properties: { a: 1, b: 2, $session_id: "s1" } });
    expect(outer).toMatchObject({ distinct_id: "explicit", properties: { a: 9, b: 1 } });
  });

  it("works across awaits and mutations stay in the child", async () => {
    await withContext({ distinctId: "p" }, async () => {
      await withContext({}, async () => {
        await Promise.resolve();
        getContext()!.distinctId = "child";
      });
      expect(getContext()?.distinctId).toBe("p");
    });
  });

  it("requires a distinct id unless personless", async () => {
    const g = fakeGateway();
    const l = mk(g);
    expect(() => l.capture({ event: "e" })).toThrow(/distinctId/);
    l.capture({ event: "e", processPersonProfile: false, $set: { a: 1 } });
    await l.shutdown();
    const e = g.events()[0]!;
    expect(e.properties.$process_person_profile).toBe(false);
    expect(e.distinct_id).toHaveLength(36);
    expect(e.$set).toBeUndefined();
  });

  it("reads tracing headers, sanitising them", () => {
    const r = readTracingHeaders({ "x-lucida-distinct-id": ` a\u0000b${"z".repeat(2000)}`, "X-LUCIDA-SESSION-ID": "  " });
    expect(r.distinctId).toHaveLength(1000);
    expect(r.distinctId?.startsWith("ab")).toBe(true);
    expect(r.sessionId).toBeUndefined();
    expect(readTracingHeaders({ get: (n: string) => (n === "X-Lucida-Session-Id" ? "s" : null) })).toEqual({ sessionId: "s" });
  });
});

describe("delivery hooks", () => {
  it("beforeSend edits, drops and keeps the original on throw", async () => {
    const g = fakeGateway();
    const errs: Error[] = [];
    const l = mk(g, {
      onError: (e: Error) => errs.push(e),
      beforeSend: (e: { event: string; properties: Record<string, unknown> }) => {
        if (e.event === "drop") return null;
        if (e.event === "boom") throw new Error("x");
        e.properties.edited = true;
        return e;
      },
    });
    for (const event of ["drop", "boom", "ok"]) l.capture({ distinctId: "u", event });
    await l.shutdown();
    const evs = g.events();
    expect(evs.map((e) => e.event)).toEqual(["boom", "ok"]);
    expect(evs[0]!.properties.edited).toBeUndefined();
    expect(evs[1]!.properties.edited).toBe(true);
    expect(errs).toHaveLength(1);
  });

  it("onError fires on a dropped batch and maxBatchSize splits requests", async () => {
    const g = fakeGateway();
    const bad = (async () => new Response("", { status: 400 })) as unknown as typeof fetch;
    const errs: Array<[Error, number]> = [];
    const l = mk(g, { fetch: bad, maxBatchSize: 2, onError: (e: Error, ev: unknown[]) => errs.push([e, ev.length]) });
    for (let i = 0; i < 3; i++) l.capture({ distinctId: "u", event: `e${i}` });
    await l.flush();
    await l.flush();
    expect(errs.map(([, n]) => n)).toEqual([2, 1]);
    await l.shutdown();
    const ok = fakeGateway();
    const l2 = mk(ok, { maxBatchSize: 2 });
    for (let i = 0; i < 3; i++) l2.capture({ distinctId: "u", event: `e${i}` });
    await l2.flush();
    await l2.shutdown();
    expect(ok.reqs.map((r) => (r.body as { batch: unknown[] }).batch.length)).toEqual([2, 1]);
  });

  it("retries with the configured count and delay", async () => {
    let calls = 0;
    const f = (async () => new Response("", { status: ++calls < 3 ? 500 : 200 })) as unknown as typeof fetch;
    const l = mk(fakeGateway(), { fetch: f, fetchRetryCount: 2, fetchRetryDelayMs: 1 });
    l.capture({ distinctId: "u", event: "e" });
    await l.flush();
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(3);
    await l.shutdown();
  });

  it("captureImmediate delivers before resolving", async () => {
    const g = fakeGateway();
    const l = mk(g);
    const id = await l.captureImmediate({ distinctId: "u", event: "now" });
    expect(id).toBeTruthy();
    expect(g.events()).toHaveLength(1);
    const bad = mk(fakeGateway(), { fetch: (async () => new Response("", { status: 500 })) as unknown as typeof fetch });
    expect(await bad.captureImmediate({ distinctId: "u", event: "x" })).toBeUndefined();
    await l.shutdown();
  });

  it("geoip, isServer, super properties", async () => {
    const g = fakeGateway();
    const l = mk(g, { isServer: true });
    l.register({ app: "x", k: "default" });
    l.capture({ distinctId: "u", event: "a", properties: { k: "mine" }, disableGeoip: true });
    l.unregister("app");
    l.capture({ distinctId: "u", event: "b" });
    await l.shutdown();
    const [a, b] = g.events();
    expect(a!.properties).toMatchObject({ $geoip_disable: true, app: "x", k: "mine", $is_server: true });
    expect(b!.properties.$geoip_disable).toBeUndefined();
    expect(b!.properties.app).toBeUndefined();
    const g2 = fakeGateway();
    const l2 = mk(g2, { disableGeoip: true });
    l2.capture({ distinctId: "u", event: "c" });
    l2.capture({ distinctId: "u", event: "d", disableGeoip: false });
    await l2.shutdown();
    expect(g2.events().map((e) => e.properties.$geoip_disable)).toEqual([true, undefined]);
  });
});

describe("flags extras", () => {
  it("remote config payload uses the secret key, and all-flags-and-payloads", async () => {
    const g = fakeGateway({
      remote: { flags: { cfg: { enabled: true, value: true, payload: { a: 1 } } } },
      remoteConfigs: { cfg: { a: 1 }, "a/b": [2] },
    });
    const l = mk(g, { secretKey: "lc_sk_x", streamFlags: false, flagsTimeoutMs: 1234 });
    await l.ready;
    expect(await l.getRemoteConfigPayload("cfg")).toEqual({ a: 1 });
    const req = g.reqs.filter((r) => r.url.endsWith("/v1/flags/cfg/remote-config")).pop()!;
    expect(req.method).toBe("GET");
    expect(req.headers.Authorization).toBe("Bearer lc_sk_x");
    expect(await l.getRemoteConfigPayload("a/b")).toEqual([2]);
    expect(g.reqs.some((r) => r.url.endsWith("/v1/flags/a%2Fb/remote-config"))).toBe(true);
    expect(await l.getRemoteConfigPayload("nope")).toBeUndefined();
    expect((await mk(g).getAllFlagsAndPayloads("u")).payloads).toEqual({ cfg: { a: 1 } });
    await l.shutdown();
    expect(() => mk(g).getRemoteConfigPayload("cfg")).toThrow(/secretKey/);
  });

  it("definition cache provider avoids a second fetch", async () => {
    const cache = new InMemoryFlagDefinitionCache(60_000);
    const g = fakeGateway({ defs: [flag("on")] });
    const a = mk(g, { secretKey: "lc_sk_x", streamFlags: false, flagDefinitionCacheProvider: cache });
    await a.ready;
    const b = mk(g, { secretKey: "lc_sk_x", streamFlags: false, flagDefinitionCacheProvider: cache });
    await b.ready;
    expect(g.reqs.filter((r) => r.url.includes("/definitions"))).toHaveLength(1);
    expect(await b.getFeatureFlag("on", "u", { onlyEvaluateLocally: true })).toBe(true);
    await a.shutdown();
    await b.shutdown();
  });
});

describe("middleware", () => {
  const req = {
    method: "POST",
    originalUrl: "/p?a=1",
    protocol: "https",
    headers: { host: "x.dev", "user-agent": "UA", "x-lucida-distinct-id": "d1", "x-lucida-session-id": "s1", "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    socket: { remoteAddress: "9.9.9.9" },
  };

  it("express: stamps request props and tracing ids", () => {
    let seen: ReturnType<typeof getContext>;
    setupRequestContext(null, { extraProperties: { svc: "api" } })(req, {}, () => (seen = getContext()));
    expect(seen!.distinctId).toBe("d1");
    expect(seen!.sessionId).toBe("s1");
    expect(seen!.properties).toEqual({
      $current_url: "https://x.dev/p?a=1",
      $request_method: "POST",
      $request_path: "/p",
      $user_agent: "UA",
      $ip: "9.9.9.9",
      svc: "api",
    });
    setupRequestContext(null, { trustProxy: true, captureTracingHeaders: false })(req, {}, () => (seen = getContext()));
    expect(seen!.distinctId).toBeUndefined();
    expect(seen!.properties.$ip).toBe("1.2.3.4");
    setupRequestContext(null, { requestFilter: () => false })(req, {}, () => (seen = getContext()));
    expect(seen).toBeUndefined();
  });

  it("fastify: onRequest hook and onClose shutdown", async () => {
    let shut = 0;
    const h = fastifyRequestContext({ shutdown: async () => void shut++ });
    let seen: ReturnType<typeof getContext>;
    h.onRequest({ ...req, url: "/p?a=1" }, {}, () => (seen = getContext()));
    expect(seen!.properties.$request_path).toBe("/p");
    await h.onClose();
    expect(shut).toBe(1);
  });

  it("nest: interceptor runs the subscription inside the context", () => {
    let seen: ReturnType<typeof getContext>;
    const next = { handle: () => ({ subscribe: (o: unknown) => ((seen = getContext()), o) }) };
    const out = new LucidaInterceptor(null).intercept({ switchToHttp: () => ({ getRequest: () => req }) }, next);
    expect(seen).toBeUndefined(); // lazy, like an observable
    out.subscribe("obs");
    expect(seen!.distinctId).toBe("d1");
    expect(typeof (out as unknown as Record<string, unknown>)["@@observable"]).toBe("function");
  });
});

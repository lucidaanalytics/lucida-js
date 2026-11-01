import { describe, expect, it } from "vitest";
import { createEdgeClient, optionsFromEnv, visitorId } from "../src/index.js";

const defs = {
  flags: [
    { key: "on", type: "boolean", active: true, salt: "s", conditions: [{ rollout_pct: 100 }], aggregation: { kind: "person" } },
    { key: "pro", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" }, conditions: [{ rollout_pct: 100, filters: [{ type: "person", key: "plan", op: "eq", value: "pro" }] }] },
    { key: "coh", type: "boolean", active: true, salt: "s", aggregation: { kind: "person" }, conditions: [{ rollout_pct: 100, filters: [{ type: "cohort", key: "c1", op: "in" }] }] },
  ],
};

function fakeFetch() {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/v1/flags/definitions")) {
      if ((init?.headers as Record<string, string>)["If-None-Match"] === '"e1"') return new Response(null, { status: 304 });
      return new Response(JSON.stringify(defs), { headers: { etag: '"e1"' } });
    }
    if (url.endsWith("/v1/flags")) return new Response(JSON.stringify({ flags: { coh: { enabled: true, value: true } } }));
    return new Response("{}");
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("EdgeClient", () => {
  it("evaluates locally, uses the remote only for cohort flags, and caches definitions by ETag", async () => {
    const { f, calls } = fakeFetch();
    const c = createEdgeClient({ apiKey: "pk", secretKey: "sk", host: "https://gw", fetch: f, ttlMs: 0 });
    expect(await c.isFeatureEnabled("on", "u1")).toBe(true);
    expect(await c.getFlag("pro", "u1", { personProperties: { plan: "pro" } })).toBe(true);
    expect(await c.getFlag("pro", "u1", { personProperties: { plan: "free" } })).toBe(false);
    expect(await c.getFlag("coh", "u1")).toBe(true);
    expect(calls.filter((x) => x.includes("definitions")).length).toBeGreaterThan(1); // ttl 0 -> revalidates (304 path)
    expect(calls.filter((x) => x.startsWith("POST") && x.endsWith("/v1/flags"))).not.toHaveLength(0); // only because the cohort flag is in the set
  });

  it("without a secret key asks the gateway", async () => {
    const { f, calls } = fakeFetch();
    const c = createEdgeClient({ apiKey: "pk", host: "https://gw", fetch: f });
    expect(await c.getAllFlags("u1")).toEqual({ coh: true });
    expect(calls).toEqual(["POST https://gw/v1/flags"]);
  });

  it("hands captures to waitUntil", async () => {
    const { f } = fakeFetch();
    const held: Promise<unknown>[] = [];
    const c = createEdgeClient({ apiKey: "pk", fetch: f, waitUntil: (p) => held.push(p) });
    c.capture("u1", "hit");
    expect(held).toHaveLength(1);
    await Promise.all(held);
  });

  it("reads env from objects and getter stores", () => {
    expect(optionsFromEnv({ LUCIDA_API_KEY: "pk", LUCIDA_SECRET_KEY: "sk" })).toMatchObject({ apiKey: "pk", secretKey: "sk" });
    expect(optionsFromEnv(new Map([["LUCIDA_API_KEY", "pk"]])).apiKey).toBe("pk");
    expect(() => optionsFromEnv({})).toThrow();
  });

  it("parses the visitor cookie", () => {
    expect(visitorId("a=1; lc_distinct_id=abc")).toEqual({ distinctId: "abc", isNew: false });
    expect(visitorId(null).isNew).toBe(true);
  });
});

describe("EdgeClient flag values on events", () => {
  it("attaches a snapshot or evaluates first, and sends app contexts", async () => {
    const bodies: Array<{ url: string; body: any }> = [];
    const f = (async (url: string, init?: RequestInit) => {
      bodies.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/v1/flags")) return new Response(JSON.stringify({ flags: { a: { enabled: true, value: "B" } } }));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const c = createEdgeClient({ apiKey: "pk", host: "https://gw", fetch: f, appContexts: ["edge"] });
    const snap = await c.evaluateFlags("u1");
    expect(snap.getFlag("a")).toBe("B");
    expect(bodies[0]!.body.app_contexts).toEqual(["edge"]);
    expect(bodies[0]!.body).not.toHaveProperty("anon_distinct_id");
    await c.evaluateFlags("u1", { anonDistinctId: "anon-1" });
    expect(bodies[1]!.body.anon_distinct_id).toBe("anon-1");
    c.capture("u1", "e1", { x: 1 }, { flags: snap });
    c.capture("u1", "e2", {}, { sendFeatureFlags: true });
    await c.flush();
    const events = bodies.filter((b) => b.url.endsWith("/v1/batch")).map((b) => b.body.batch[0]);
    expect(events.find((e: any) => e.event === "e1").properties).toMatchObject({ x: 1, "$feature/a": "B", $active_feature_flags: ["a"] });
    expect(events.find((e: any) => e.event === "e2").properties["$feature/a"]).toBe("B");
  });
});

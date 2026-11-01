import { describe, expect, it } from "vitest";
import { Lucida, captureHandler, flagsHandler } from "../src/index.js";
import type { CaptureArgs } from "../src/index.js";

const component = { lib: { capture: "ref:capture", flags: "ref:flags" } };

function fakeFetch() {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    bodies.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    if (url.endsWith("/v1/flags")) return new Response(JSON.stringify({ flags: { beta: { enabled: true, value: true } } }));
    return new Response("{}");
  }) as unknown as typeof fetch;
  return { f, bodies };
}

describe("Lucida Convex client", () => {
  it("schedules captures from mutations and calls the action directly from actions", async () => {
    const lucida = new Lucida(component, { apiKey: "lc_pk_t", host: "https://gw" });
    const scheduled: [number, unknown, CaptureArgs][] = [];
    await lucida.capture({ scheduler: { runAfter: async (ms, fn, a) => void scheduled.push([ms, fn, a]) } }, "u1", "signed_up", { plan: "pro" });
    expect(scheduled).toHaveLength(1);
    const [ms, ref, args] = scheduled[0]!;
    expect([ms, ref, args.distinctId, args.event, args.apiKey, args.host]).toEqual([0, "ref:capture", "u1", "signed_up", "lc_pk_t", "https://gw"]);
    expect(args.uuid).toMatch(/^[0-9a-f-]{36}$/);

    const ran: unknown[] = [];
    await lucida.capture({ runAction: async (fn, a) => void ran.push([fn, a]) }, "u1", "x");
    expect((ran[0] as unknown[])[0]).toBe("ref:capture");
  });

  it("needs a key and reads LUCIDA_API_KEY at call time", async () => {
    const lucida = new Lucida(component);
    const ctx = { runAction: async () => undefined };
    await expect(lucida.capture(ctx, "u", "e")).rejects.toThrow(/LUCIDA_API_KEY/);
    process.env.LUCIDA_API_KEY = "lc_pk_env";
    let seen: unknown;
    await lucida.capture({ runAction: async (_f, a) => void (seen = a) }, "u", "e");
    expect((seen as CaptureArgs).apiKey).toBe("lc_pk_env");
    delete process.env.LUCIDA_API_KEY;
  });

  it("flag helpers go through the flags action", async () => {
    const lucida = new Lucida(component, { apiKey: "lc_pk_t" });
    const ctx = { runAction: async (_f: never, a: { key?: string }) => (a.key ? (a.key === "beta" ? true : null) : { beta: true }) };
    expect(await lucida.isFeatureEnabled(ctx as never, "beta", "u1")).toBe(true);
    expect(await lucida.isFeatureEnabled(ctx as never, "nope", "u1")).toBe(false);
    expect(await lucida.getAllFlags(ctx as never, "u1")).toEqual({ beta: true });
  });
});

describe("component handlers", () => {
  it("capture posts one event with the caller's uuid and timestamp (retries dedupe)", async () => {
    const { f, bodies } = fakeFetch();
    const args = { apiKey: "lc_pk_t", host: "https://gw/", distinctId: "u1", event: "paid", properties: { amount: 5 }, uuid: "0190-fixed", timestamp: "2026-11-01T00:00:00.000Z" };
    await captureHandler(args, f);
    await captureHandler(args, f);
    expect(bodies).toHaveLength(2);
    const ev = (bodies[0]!.body.batch as Record<string, unknown>[])[0]!;
    expect(bodies[0]!.url).toBe("https://gw/v1/batch");
    expect([ev.uuid, ev.timestamp, ev.event, ev.distinct_id]).toEqual(["0190-fixed", "2026-11-01T00:00:00.000Z", "paid", "u1"]);
    expect((bodies[1]!.body.batch as Record<string, unknown>[])[0]!.uuid).toBe("0190-fixed");
  });

  it("flags returns one value or all of them", async () => {
    const { f } = fakeFetch();
    expect(await flagsHandler({ apiKey: "lc_pk_t", host: "https://gw", key: "beta", distinctId: "u1" }, f)).toBe(true);
    expect(await flagsHandler({ apiKey: "lc_pk_t", host: "https://gw", key: "none", distinctId: "u1" }, f)).toBeNull();
    expect(await flagsHandler({ apiKey: "lc_pk_t", host: "https://gw", distinctId: "u1" }, f)).toEqual({ beta: true });
  });
});

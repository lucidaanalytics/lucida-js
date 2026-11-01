import { describe, expect, it } from "vitest";
import { lucida } from "../src/index.js";
import type { HonoContextLike, LucidaRequest } from "../src/index.js";

function run(req: Request, opts?: Parameters<typeof lucida>[1]) {
  const sent: Array<{ distinctId: string; event: string; properties?: Record<string, unknown> }> = [];
  let got: LucidaRequest | undefined;
  const c: HonoContextLike = { req: { raw: req }, set: (_k, v) => void (got = v) };
  let nexted = false;
  const done = lucida({ capture: (i) => void sent.push(i) }, opts)(c, async () => void (nexted = true));
  return { sent, done, get: () => got!, nexted: () => nexted };
}

describe("hono middleware", () => {
  it("exposes the tracing ids and request props, then continues the chain", async () => {
    const req = new Request("https://api.test/orders/9?x=1", {
      method: "post",
      headers: { "X-Lucida-Distinct-Id": "u1", "X-Lucida-Session-Id": "s1", "user-agent": "UA", "x-forwarded-for": "5.5.5.5, 2.2.2.2" },
    });
    const r = run(req, { trustProxy: true });
    await r.done;
    expect(r.nexted()).toBe(true);
    expect(r.get().distinctId).toBe("u1");
    expect(r.get().sessionId).toBe("s1");
    expect(r.get().context.props).toMatchObject({ $request_method: "POST", $request_path: "/orders/9", $ip: "5.5.5.5", $user_agent: "UA" });
  });

  it("capture merges context props, lets explicit properties and ids win", async () => {
    const r = run(new Request("https://api.test/a", { headers: { "x-lucida-distinct-id": "u1" } }));
    await r.done;
    r.get().capture("paid", { total: 5, $request_path: "/override" });
    r.get().capture("other", {}, "u2");
    expect(r.sent[0]).toMatchObject({ distinctId: "u1", event: "paid", properties: { total: 5, $request_path: "/override", $current_url: "https://api.test/a" } });
    expect(r.sent[1]!.distinctId).toBe("u2");
  });

  it("anonymous requests become personless events with a random id", async () => {
    const r = run(new Request("https://api.test/a"));
    await r.done;
    r.get().capture("hit");
    expect(r.sent[0]!.distinctId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.sent[0]!.properties).toMatchObject({ $process_person_profile: false });
  });

  it("remoteAddr callback supplies $ip, and a spoofed X-Forwarded-For is ignored without trustProxy", async () => {
    const r = run(new Request("https://api.test/a", { headers: { "x-forwarded-for": "6.6.6.6" } }), { remoteAddr: () => "10.0.0.5" });
    await r.done;
    expect(r.get().context.props.$ip).toBe("10.0.0.5");
  });
});

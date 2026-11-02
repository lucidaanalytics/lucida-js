import { createEdgeClient } from "@lucida-analytics/edge";
import { describe, expect, it } from "vitest";
import { lucidaHandle } from "../src/server.js";
import type { RequestEventLike } from "../src/server.js";

const client = createEdgeClient({
  apiKey: "lc_pk_x",
  host: "https://gw.test",
  fetch: (async () => new Response(JSON.stringify({ flags: { beta: { enabled: true, value: true } } }), { status: 200 })) as unknown as typeof fetch,
});

const event = (headers: Record<string, string> = {}, over: Partial<RequestEventLike> = {}): RequestEventLike => ({
  request: new Request("https://app.test/dash?x=1", { method: "GET", headers }),
  locals: {},
  getClientAddress: () => "10.0.0.2",
  ...over,
});

describe("lucidaHandle", () => {
  it("fills event.locals.lucida with the visitor, flags and request context", async () => {
    const e = event({ "x-lucida-distinct-id": "d1", "x-lucida-session-id": "s1", "user-agent": "UA", "x-forwarded-for": "4.4.4.4" });
    const res = await lucidaHandle(client, { consentMode: "off", trustProxy: true })({ event: e, resolve: () => new Response("ok") });
    expect(await res.text()).toBe("ok");
    const lc = e.locals.lucida!;
    expect(lc.flags).toEqual({ beta: true });
    expect(lc.distinctId).toBeTruthy();
    expect(lc.context).toMatchObject({ distinctId: "d1", sessionId: "s1", props: { $request_path: "/dash", $ip: "4.4.4.4", $user_agent: "UA" } });
  });

  it("sets the id cookie only when consent allows, on an immutable response too", async () => {
    const immutable = () => Response.redirect("https://app.test/login", 302);
    const withConsent = event();
    const res = await lucidaHandle(client, { consentMode: "off" })({ event: withConsent, resolve: immutable });
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain(withConsent.locals.lucida!.distinctId);
    const without = await lucidaHandle(client, { consentMode: "opt_in" })({ event: event(), resolve: () => new Response("ok") });
    expect(without.headers.get("set-cookie")).toBeNull();
  });

  it("leaves $ip unset when the adapter has no peer address, else uses it", async () => {
    const e = event({}, { getClientAddress: () => { throw new Error("no address"); } });
    await lucidaHandle(client, { consentMode: "off" })({ event: e, resolve: () => new Response("") });
    expect(e.locals.lucida!.context.props.$ip).toBeUndefined();
    const f = event();
    await lucidaHandle(client, { consentMode: "off" })({ event: f, resolve: () => new Response("") });
    expect(f.locals.lucida!.context.props.$ip).toBe("10.0.0.2");
  });
});

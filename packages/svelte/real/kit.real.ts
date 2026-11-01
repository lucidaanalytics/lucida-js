// Runs against the REAL @sveltejs/kit (installed by the lucida-js CI job, never a dependency of this package):
// our handle must satisfy SvelteKit's own `Handle` type and compose with its `sequence()`.
import type { Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { createEdgeClient } from "@lucida/edge";
import { describe, expect, it } from "vitest";
import { lucidaHandle } from "../src/server.js";

const client = createEdgeClient({
  apiKey: "lc_pk_x",
  host: "https://gw.test",
  fetch: (async () => new Response(JSON.stringify({ flags: { beta: { enabled: true, value: true } } }), { status: 200 })) as unknown as typeof fetch,
});

describe("lucidaHandle with the real SvelteKit", () => {
  it("is assignable to Handle (type drift fails `tsgo -p real`) and composes with sequence()", async () => {
    const mine: Handle = lucidaHandle(client, { consentMode: "off" });
    const order: string[] = [];
    const other: Handle = async ({ event, resolve }) => {
      order.push(`other:${event.locals.lucida?.distinctId ? "has-visitor" : "no-visitor"}`);
      return resolve(event);
    };
    const handle = sequence(mine, other);
    const event = {
      request: new Request("https://app.test/dash"),
      locals: {},
      getClientAddress: () => "10.0.0.1",
      url: new URL("https://app.test/dash"),
    } as unknown as Parameters<Handle>[0]["event"];
    const res = await handle({ event, resolve: async () => new Response("ok") });
    expect(await res.text()).toBe("ok");
    expect(order).toEqual(["other:has-visitor"]);
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });
});

import { createApp, defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@lucida-analytics/browser";
import { lucida, useActiveFlags, useCapture, useConsent, useFlag, useFlagPayload, useLucida } from "../src/index.js";

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

let unmount: (() => void) | undefined;
afterEach(() => unmount?.());

function mount(setup: () => unknown, opts: object) {
  const out: { value?: unknown } = {};
  const C = defineComponent({
    setup() {
      out.value = setup();
      return () => h("div");
    },
  });
  const app = createApp(C);
  app.use(lucida, opts);
  const el = document.createElement("div");
  app.mount(el);
  unmount = () => app.unmount();
  return out;
}

describe("@lucida-analytics/vue", () => {
  it("useFlag is reactive, exposes after mount, and follows flag reloads", async () => {
    const f = fakeClient();
    const r = mount(() => ({ flag: useFlag("beta"), active: useActiveFlags(), payload: useFlagPayload("beta") }), {
      client: f.client,
      bootstrapFlags: { beta: "b" },
    });
    const v = r.value as { flag: { value: unknown }; active: { value: string[] }; payload: { value: unknown } };
    expect(v.flag.value).toBe("b");
    expect(f.calls).toContain("expose:beta");
    f.push({ beta: false, other: true });
    await nextTick();
    expect(v.flag.value).toBe(false);
    expect(v.active.value).toEqual(["other"]);
    expect(v.payload.value).toEqual({ k: "beta" });
  });

  it("useCapture and useConsent drive the client; useLucida returns it", () => {
    const f = fakeClient();
    const r = mount(() => ({ cap: useCapture(), consent: useConsent(), c: useLucida() }), { client: f.client });
    const v = r.value as { cap: (e: string) => void; consent: ReturnType<typeof useConsent>; c: unknown };
    v.cap("clicked");
    v.consent.grant();
    v.consent.revoke();
    expect(v.c).toBe(f.client);
    expect(f.calls).toEqual([
      "capture:clicked",
      'consent:{"analytics":true,"replay":true}',
      'consent:{"analytics":false,"replay":false,"marketing":false}',
    ]);
  });

  it("is inert without a client or apiKey, and throws without the plugin", () => {
    const r = mount(() => ({ c: useLucida(), flag: useFlag("x"), cap: useCapture() }), {});
    const v = r.value as { c: unknown; flag: { value: unknown }; cap: (e: string) => void };
    expect(v.c).toBeNull();
    expect(v.flag.value).toBeUndefined();
    expect(() => v.cap("noop")).not.toThrow();
    const app = createApp(defineComponent({ setup: () => (useLucida(), () => h("div")) }));
    app.config.warnHandler = () => {};
    expect(() => app.mount(document.createElement("div"))).toThrow(/app.use\(lucida/);
  });

  it("creates its own consent-aware client from apiKey (opt_in: no events before grant)", async () => {
    const sent: string[] = [];
    const r = mount(() => ({ c: useLucida()!, consent: useConsent(), cap: useCapture() }), {
      apiKey: "lc_pk_vue",
      options: {
        persistence: "memory",
        consent: { mode: "opt_in" },
        capturePageview: false,
        offlineQueue: false,
        transport: { send: async (_u: string, body: string) => (sent.push(...(JSON.parse(body) as { batch: { event: string }[] }).batch.map((e) => e.event)), { status: 200 }) },
        fetch: (async () => new Response("{}", { status: 404 })) as typeof fetch,
      },
    });
    const v = r.value as { c: Client; consent: ReturnType<typeof useConsent>; cap: (e: string) => void };
    v.cap("before");
    await v.c.flush();
    expect(sent).toEqual([]);
    v.consent.grant();
    v.cap("after");
    await v.c.flush();
    expect(sent).toContain("after");
    expect(sent).not.toContain("before");
    await v.c.shutdown();
  });
});

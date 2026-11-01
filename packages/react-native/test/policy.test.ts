import { describe, expect, it } from "vitest";
import { chainFromFiber, createClient, createAutocapture, runHooks, sampleHook, splitBatches, touchHandler, tracedFetch, tracingHeaders } from "../src/index.js";
import type { NativeConfig } from "../src/index.js";

interface Sent {
  event: string;
  distinct_id?: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

function setup(over: NativeConfig = {}, flagsBody: unknown = { flags: {} }) {
  const sent: Sent[] = [];
  const flagBodies: Array<Record<string, unknown>> = [];
  const cfg: NativeConfig = {
    apiHost: "https://ingest.test",
    flushAt: 1000,
    flushIntervalMs: 3_600_000,
    transport: {
      send: async (_u, body) => {
        sent.push(...(JSON.parse(body) as { batch: Sent[] }).batch);
        return { status: 200 };
      },
    },
    fetch: (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/v1/flags")) flagBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return { ok: true, status: 200, json: async () => flagsBody };
    }) as unknown as typeof fetch,
    ...over,
  };
  return { cfg, sent, flagBodies };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const ev = (event: string, properties: Record<string, unknown> = {}) => ({ uuid: "u", event, timestamp: "t", properties });

describe("beforeSend", () => {
  it("amends, drops, and keeps the event when a hook throws", async () => {
    const logs: unknown[][] = [];
    const out = runHooks(
      [
        (e) => ({ ...e, properties: { ...e.properties, a: 1 } }),
        () => {
          throw new Error("boom");
        },
        (e) => (e.event === "drop" ? null : e),
        (e) => ({ ...e, properties: { ...e.properties, b: e.properties.a } }),
      ],
      ev("keep"),
      (...a) => logs.push(a),
    );
    expect(out?.properties).toMatchObject({ a: 1, b: 1 });
    expect(logs).toHaveLength(1);
    expect(runHooks([(e) => (e.event === "drop" ? null : e)], ev("drop"), () => {})).toBeNull();
  });

  it("sampleHook stamps survivors", () => {
    expect(sampleHook(0.5, () => 0.1)(ev("x", { p: 1 }))?.properties).toEqual({ p: 1, $sample_rate: 0.5 });
    expect(sampleHook(0.5, () => 0.9)(ev("x"))).toBeNull();
    expect(sampleHook(0, () => 0)(ev("x"))).toBeNull();
    const all = ev("x");
    expect(sampleHook(1, () => 0.99)(all)).toBe(all);
  });

  it("runs on queued events end to end, including drops", async () => {
    const { cfg, sent } = setup({ beforeSend: [(e) => (e.event === "secret" ? null : { ...e, properties: { ...e.properties, tagged: true } })] });
    const c = await createClient("k", cfg);
    c.capture("secret");
    c.capture("visible");
    await c.flush();
    expect(sent.map((e) => e.event)).not.toContain("secret");
    expect(sent.find((e) => e.event === "visible")?.properties.tagged).toBe(true);
  });
});

describe("personProfiles", () => {
  it("identified_only flips on identify and reset clears it", async () => {
    const { cfg, sent } = setup({ personProfiles: "identified_only" });
    const c = await createClient("k", cfg);
    c.capture("a");
    c.identify("u1");
    c.capture("b");
    c.reset();
    c.capture("c");
    await c.flush();
    const flag = (n: string) => sent.find((e) => e.event === n)?.properties.$process_person_profile;
    expect(flag("a")).toBe(false);
    expect(flag("$identify")).toBeUndefined();
    expect(flag("b")).toBeUndefined();
    expect(flag("c")).toBe(false);
  });

  it("identified_only flips on a person property write", async () => {
    const { cfg, sent } = setup({ personProfiles: "identified_only" });
    const c = await createClient("k", cfg);
    c.setPersonProperties({ x: 1 });
    c.capture("after");
    await c.flush();
    expect(sent.find((e) => e.event === "after")?.properties.$process_person_profile).toBeUndefined();
  });

  it("never blocks identity and person writes", async () => {
    const { cfg, sent } = setup({ personProfiles: "never" });
    const c = await createClient("k", cfg);
    const id = c.distinctId;
    c.identify("u1", { a: 1 });
    c.alias("z");
    c.setPersonProperties({ a: 1 });
    c.capture("a", {}, { set: { a: 1 } });
    await c.flush();
    expect(c.distinctId).toBe(id);
    const names = sent.map((e) => e.event);
    expect(names).not.toContain("$identify");
    expect(names).not.toContain("$create_alias");
    expect(names).not.toContain("$set");
    const a = sent.find((e) => e.event === "a")!;
    expect(a.$set).toBeUndefined();
    expect(a.properties.$process_person_profile).toBe(false);
  });
});

describe("flags: bootstrap, updateFlags, remote off, options", () => {
  it("bootstraps identity and flags, injects flags, and never calls /v1/flags when remote is disabled", async () => {
    const { cfg, flagBodies, sent } = setup({
      disableRemoteFeatureFlags: true,
      flagOptions: { bootstrap: { distinctId: "boot-1", isIdentified: true, flags: { b: "v1" }, payloads: { b: { k: 1 } } }, sendFeatureFlagEvent: false },
    });
    const c = await createClient("k", cfg);
    expect(c.distinctId).toBe("boot-1");
    expect(c.getFlag("b")).toBe("v1");
    expect(c.getFlagPayload("b")).toEqual({ k: 1 });
    const seen: Array<Record<string, unknown>> = [];
    c.onFlags((f) => seen.push(f));
    c.updateFlags({ x: true }, { x: 2 }, { merge: true });
    expect(c.getFlag("b")).toBe("v1");
    expect(c.getFlag("x")).toBe(true);
    c.updateFlags({ y: true });
    expect(c.getFlag("b")).toBeUndefined();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    await c.reloadFlags();
    await c.flush();
    expect(flagBodies).toHaveLength(0);
    expect(sent.map((e) => e.event)).not.toContain("$feature_flag_called");
    // an identified bootstrap id switching to a new user sends $identify without the anon link
    c.identify("real");
    await c.flush();
    expect(sent.find((e) => e.event === "$identify")?.properties.$anon_distinct_id).toBeUndefined();
  });

  it("sends evaluation properties and contexts, and preload=false defers the first request", async () => {
    const { cfg, flagBodies } = setup({ flagOptions: { preload: false, evaluationContexts: ["prod"] } }, { flags: { f: true } });
    const c = await createClient("k", cfg);
    await tick();
    expect(flagBodies).toHaveLength(0);
    await c.setPersonPropertiesForFlags({ plan: "pro" }, false);
    expect(flagBodies).toHaveLength(0);
    await c.setGroupPropertiesForFlags("company", { tier: 2 });
    expect(flagBodies[0]).toMatchObject({ person_properties: { plan: "pro" }, group_properties: { company: { tier: 2 } }, app_contexts: ["prod"] });
    expect(c.getFlag("f")).toBe(true);
    await c.resetPersonPropertiesForFlags();
    expect(flagBodies.at(-1)?.person_properties).not.toHaveProperty("plan"); // default props ($lib) stay
  });
});

describe("client options", () => {
  it("geoip, anonymous id helpers, opt-out, per-capture set, deep link", async () => {
    const { cfg, sent } = setup({ disableGeoip: true, reuseAnonymousId: true });
    const c = await createClient("k", cfg);
    const anon = c.getAnonymousId();
    expect(anon).toBe(c.distinctId);
    c.identify("u1");
    c.reset();
    expect(c.distinctId).toBe(anon);
    c.capture("x", {}, { set: { k: "v" }, setOnce: { o: 1 } });
    c.openURL("myapp://item/3?ref=a%20b&x=1#frag", "ref://x");
    expect(c.isOptedOut()).toBe(false);
    await c.flush();
    const x = sent.find((e) => e.event === "x")!;
    expect(x.properties.$geoip_disable).toBe(true);
    expect(x.$set).toEqual({ k: "v" });
    expect(x.$set_once).toEqual({ o: 1 });
    const d = sent.find((e) => e.event === "$deep_link_opened")!;
    expect(d.properties).toMatchObject({ query: { ref: "a b", x: "1" }, referrer: "ref://x" });
    c.optOut();
    expect(c.isOptedOut()).toBe(true);
  });

  it("splits batches and surfaces the first failing status", async () => {
    const calls: number[] = [];
    let n = 0;
    const t = splitBatches(
      {
        send: async (_u, body) => {
          calls.push((JSON.parse(body) as { batch: unknown[] }).batch.length);
          return { status: ++n === 2 ? 500 : 200 };
        },
      },
      2,
    );
    const body = JSON.stringify({ api_key: "k", batch: [1, 2, 3, 4, 5] });
    expect((await t.send("u", body)).status).toBe(500);
    expect(calls).toEqual([2, 2]);
    n = 5;
    calls.length = 0;
    expect((await t.send("u", body)).status).toBe(200);
    expect(calls).toEqual([2, 2, 1]);
  });

  it("wifi-only mode holds events until Wi-Fi is available", async () => {
    let wifi = false;
    const { cfg, sent } = setup({ dataMode: "wifi", network: { isWifi: () => wifi }, flushIntervalMs: 3_600_000 });
    const c = await createClient("k", cfg);
    c.capture("e");
    await c.flush();
    expect(sent).toHaveLength(0);
    wifi = true;
    await c.flush();
    expect(sent.map((e) => e.event)).toContain("e");
  });

  it("session expiry config rotates the session", async () => {
    const { cfg, sent } = setup({ sessionIdleMs: 5 });
    const c = await createClient("k", cfg);
    c.capture("a");
    await new Promise((r) => setTimeout(r, 15));
    c.capture("b");
    await c.flush();
    const sid = (n: string) => sent.find((e) => e.event === n)?.properties.$session_id;
    expect(sid("a")).not.toBe(sid("b"));
  });

  it("request timeout aborts a hung fetch as status 0 via the default transport", async () => {
    const { cfg } = setup({ requestTimeoutMs: 5 });
    delete cfg.transport;
    let aborted = false;
    cfg.fetch = ((_u: string, init?: RequestInit) =>
      new Promise((_r, rej) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          rej(new Error("aborted"));
        });
      })) as unknown as typeof fetch;
    const c = await createClient("k", cfg);
    c.capture("a");
    await c.flush();
    expect(aborted).toBe(true);
  });
});

describe("tracing headers", () => {
  it("matches exact and suffix hosts, never the Lucida host, needs consent", async () => {
    let consent = true;
    const h = tracingHeaders(["api.example.com", ".corp.io", "ingest.test"], "https://ingest.test", () => consent, () => ({ distinctId: "d", sessionId: "s" }));
    expect(h("https://api.example.com/v1/x")).toEqual({ "X-Lucida-Distinct-Id": "d", "X-Lucida-Session-Id": "s" });
    expect(Object.keys(h("https://a.corp.io/x"))).toHaveLength(2);
    expect(h("https://corp.io/x")).toEqual({});
    expect(h("https://other.com/x")).toEqual({});
    expect(h("https://ingest.test/v1/batch")).toEqual({});
    consent = false;
    expect(h("https://api.example.com/v1/x")).toEqual({});
  });

  it("tracedFetch adds the headers only for matching hosts", async () => {
    const seen: Array<Record<string, string>> = [];
    const f = tracedFetch(
      (async (_u: unknown, init?: RequestInit) => {
        seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
        return new Response("");
      }) as typeof fetch,
      (u) => (u.includes("mine") ? { "X-Lucida-Distinct-Id": "d" } : {}),
    );
    await f("https://mine.example.com/a", { headers: { Accept: "x" } });
    await f("https://other.com/a");
    expect(seen[0]).toMatchObject({ "x-lucida-distinct-id": "d", accept: "x" });
    expect(seen[1]).toEqual({});
  });

  it("client.fetch uses the live identity", async () => {
    const seen: Array<Record<string, string>> = [];
    const { cfg } = setup({ tracingHeaders: ["mine.example.com"] });
    const real = cfg.fetch!;
    cfg.fetch = (async (u: string, init?: RequestInit) => {
      if (u.includes("mine.example.com")) seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return real(u, init);
    }) as unknown as typeof fetch;
    const c = await createClient("k", cfg);
    await c.fetch("https://mine.example.com/a");
    expect(seen[0]?.["x-lucida-distinct-id"]).toBe(c.distinctId);
    expect(seen[0]?.["x-lucida-session-id"]).toBeTruthy();
  });
});

describe("autocapture", () => {
  const btn = { name: "Pressable", label: "Buy", props: { testID: "buy", secret: "s" } };

  it("is off by default and honours the exclusion marker", async () => {
    const { cfg, sent } = setup();
    const c = await createClient("k", cfg);
    c.autocapture.tap([btn], 0, 0);
    expect(sent.filter((e) => e.event === "$autocapture")).toHaveLength(0);
    const { cfg: cfg2, sent: sent2 } = setup({ autocapture: { enabled: true } });
    const c2 = await createClient("k", cfg2);
    c2.autocapture.tap([btn, { name: "root", noCapture: true }], 0, 0);
    c2.autocapture.tap([btn], 0, 0);
    await c2.flush();
    expect(sent2.filter((e) => e.event === "$autocapture")).toHaveLength(1);
  });

  it("ignore labels, max elements, allow-list and no input values", async () => {
    const { cfg, sent } = setup({ autocapture: { enabled: true, ignoreLabels: ["skip"], maxElements: 2, propsAllowList: ["testID"] } });
    const c = await createClient("k", cfg);
    c.autocapture.tap([btn, { name: "skip" }, { name: "c" }, { name: "d" }], 1, 1);
    c.autocapture.tap([{ name: "TextInput", label: "hunter2", isInput: true }], 1, 1);
    c.autocapture.change([{ name: "Switch" }]);
    await c.flush();
    const ac = sent.filter((e) => e.event === "$autocapture");
    const els = ac[0]!.properties.$elements as Array<Record<string, unknown>>;
    expect(els).toHaveLength(2);
    expect(els[0]).toMatchObject({ tag_name: "Pressable", attr__testID: "buy", text: "Buy" });
    expect(els[0]).not.toHaveProperty("attr__secret");
    expect(ac[0]!.properties.$el_text).toBe("Buy");
    expect(ac[1]!.properties.$el_text).toBe("");
    expect(ac[2]!.properties.$event_type).toBe("change");
  });

  it("rage taps fire once after minTaps", async () => {
    const { cfg, sent } = setup({ autocapture: { enabled: true } });
    const c = await createClient("k", cfg);
    for (let i = 0; i < 3; i++) c.autocapture.tap([btn], 10, 10);
    for (let i = 0; i < 3; i++) c.autocapture.tap([btn], i * 100, 0);
    await c.flush();
    expect(sent.filter((e) => e.event === "$rageclick")).toHaveLength(1);
  });

  it("builds the chain from a fiber without reading input values", () => {
    const root = { type: { displayName: "App" }, memoizedProps: { lucidaNoCapture: true } };
    const input = { type: "RCTSinglelineTextInputView", memoizedProps: { value: "hunter2", testID: "pw" }, return: root };
    const pressable = { type: { displayName: "Pressable" }, memoizedProps: { accessibilityLabel: "Buy", testID: "b" }, return: input };
    const unlabeled = { type: "View", memoizedProps: {}, return: pressable };
    const chain = chainFromFiber(unlabeled, { enabled: true });
    expect(chain.map((e) => e.name)).toEqual(["Pressable", "RCTSinglelineTextInputView", "App"]);
    expect(chain[1]).toMatchObject({ isInput: true });
    expect(chain[2]).toMatchObject({ noCapture: true });
    const calls: unknown[] = [];
    const ac = { config: { enabled: true }, tap: (...a: unknown[]) => calls.push(a), change: () => {} };
    touchHandler(ac)({ nativeEvent: { pageX: 5, pageY: 6 }, _targetInst: pressable });
    expect(calls).toHaveLength(1);
    const off = { ...ac, config: { enabled: false } };
    touchHandler(off)({ _targetInst: pressable });
    expect(calls).toHaveLength(1);
    void createAutocapture;
  });
});

describe("replay privacy options", () => {
  it("passes mask options to the native module and applies sampling, throttle and start/stop", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const post: unknown[] = [];
    const mod = {
      async captureWireframe(o: Record<string, unknown>) {
        calls.push(o);
        return JSON.stringify({ events: [{ type: 4, data: {} }, { type: 2, data: { node: { text: String(calls.length) } } }] });
      },
    };
    let tickFn: () => void = () => {};
    let clock = 0;
    const base = setup({ consent: { mode: "opt_out" } });
    base.cfg.fetch = (async (u: string, init?: RequestInit) => {
      if (String(u).endsWith("/v1/replay")) post.push(init?.body);
      return { ok: true, status: 200, json: async () => ({ flags: {} }) };
    }) as unknown as typeof fetch;
    base.cfg.replay = {
      enabled: true,
      module: mod as never,
      maskAllTextInputs: false,
      maskAllImages: false,
      maskSandboxedViews: false,
      throttleMs: 1000,
      setInterval: (fn) => ((tickFn = fn), 1),
      clearInterval: () => {},
    };
    const c = await createClient("k", base.cfg);
    void clock;
    tickFn();
    await tick();
    expect(calls[0]).toMatchObject({ maskText: true, maskAllTextInputs: false, maskAllImages: false, maskSandboxedViews: false });
    tickFn();
    await tick();
    expect(calls).toHaveLength(1); // inside the throttle window
    expect(c.replay.isRecording()).toBe(true);
    c.replay.stop();
    expect(c.replay.isRecording()).toBe(false);

    const off = setup();
    off.cfg.replay = { enabled: true, module: mod as never, sampleRate: 0, setInterval: (fn) => ((tickFn = fn), 1), clearInterval: () => {} };
    const c2 = await createClient("k", off.cfg);
    tickFn();
    await tick();
    expect(calls).toHaveLength(1);
    expect(c2.replay.isRecording()).toBe(false);
    expect(post.length).toBe(1);
  });
});

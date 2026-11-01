import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Core, SessionManager } from "../src/index.js";
import type { CoreConfig } from "../src/index.js";
import { FakeTransport, MemStorage } from "./helpers.js";

function make(over: Partial<CoreConfig> = {}) {
  const transport = new FakeTransport();
  const storage = new MemStorage();
  const core = new Core({
    apiKey: "lc_pk_test",
    apiHost: "https://h",
    transport,
    storage,
    library: { name: "t", version: "1" },
    ...over,
  });
  return { core, transport, storage };
}

describe("consent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opt_in: zero transport calls and zero storage writes before grant", async () => {
    const { core, transport, storage } = make({ consent: { mode: "opt_in", queueBeforeConsent: true } });
    core.capture("a");
    core.identify("user-1", { plan: "pro" });
    core.register({ k: 1 });
    core.group("company", "acme");
    await core.flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.calls).toHaveLength(0);
    expect(storage.writes).toBe(0);
    expect(core.queue.size).toBe(0);
  });

  it("opt_in without queueBeforeConsent drops events", () => {
    const { core } = make({ consent: { mode: "opt_in" } });
    expect(core.capture("a")).toBeUndefined();
  });

  it("opt_in: grant persists state, releases held events, sends $opt_in", async () => {
    const { core, transport, storage } = make({ consent: { mode: "opt_in", queueBeforeConsent: true } });
    core.capture("held");
    core.optIn();
    expect(storage.writes).toBeGreaterThan(0);
    expect(storage.get("lc_identity")).toContain(core.distinctId);
    await core.flush();
    expect(transport.events().map((e) => e.event)).toEqual(["held", "$opt_in"]);
  });

  it("opt_out mode sends by default; optOut sends $opt_out then stops", async () => {
    const { core, transport } = make();
    core.capture("a");
    core.optOut();
    core.capture("b");
    await core.flush();
    expect(transport.events().map((e) => e.event)).toEqual(["a", "$opt_out"]);
  });

  it("honours DNT when configured", () => {
    const { core } = make({ consent: { respectDnt: true, dnt: true } });
    expect(core.capture("a")).toBeUndefined();
  });

  it("restores a stored decision", () => {
    const storage = new MemStorage();
    storage.set("lc_consent", JSON.stringify({ analytics: true, replay: false, marketing: false }));
    const { core } = make({ storage, consent: { mode: "opt_in" } });
    expect(core.hasConsent("analytics")).toBe(true);
    expect(core.hasConsent("replay")).toBe(false);
  });
});

describe("identity flows", () => {
  it("identify links the anon id once and uses the new distinct_id", async () => {
    const { core, transport } = make();
    const anon = core.distinctId;
    core.identify("u1", { email: "a@b.c" });
    core.capture("x");
    await core.flush();
    const [idf, x] = transport.events() as Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }>;
    expect(idf?.event).toBe("$identify");
    expect(idf?.distinct_id).toBe("u1");
    expect(idf?.properties.$anon_distinct_id).toBe(anon);
    expect(x?.distinct_id).toBe("u1");
  });

  it("second identify with a different id has no anon link", async () => {
    const { core, transport } = make();
    core.identify("u1");
    core.identify("u2");
    await core.flush();
    expect(transport.events()[1]?.properties.$anon_distinct_id).toBeUndefined();
  });

  it("identify with same id sends nothing unless props given", async () => {
    const { core, transport } = make();
    core.identify("u1");
    core.identify("u1");
    await core.flush();
    expect(transport.events()).toHaveLength(1);
  });

  it("alias emits $create_alias", async () => {
    const { core, transport } = make();
    core.alias("old-id");
    await core.flush();
    const e = transport.events()[0]!;
    expect(e.event).toBe("$create_alias");
    expect(e.properties).toMatchObject({ alias: "old-id", distinct_id: core.distinctId });
  });

  it("reset gives a fresh anon id and clears super props, groups", async () => {
    const { core, transport } = make();
    core.identify("u1");
    core.register({ a: 1 });
    core.group("company", "acme");
    core.reset();
    expect(core.distinctId).not.toBe("u1");
    core.capture("after");
    await core.flush();
    const last = transport.events().at(-1)!;
    expect(last.properties.a).toBeUndefined();
    expect(core.groups).toBeUndefined();
  });

  it("persists identity across instances sharing storage", () => {
    const { core, storage } = make();
    core.identify("u1");
    const again = make({ storage }).core;
    expect(again.distinctId).toBe("u1");
  });

  it("bootstrap distinct id is used when nothing is stored", () => {
    expect(make({ bootstrapDistinctId: "boot" }).core.distinctId).toBe("boot");
  });
});

describe("super properties and groups", () => {
  it("register / registerOnce / unregister and event props override", async () => {
    const { core, transport } = make();
    core.register({ a: 1, b: 2 });
    core.registerOnce({ a: 9, c: 3 });
    core.unregister("b");
    core.capture("e", { c: 4 });
    core.group("company", "acme", { plan: "x" });
    core.capture("g");
    await core.flush();
    const evs = transport.calls.flatMap((c) => JSON.parse(c.body).batch);
    expect(evs[0].properties).toMatchObject({ a: 1, c: 4 });
    expect(evs[0].properties.b).toBeUndefined();
    expect(evs[1].event).toBe("$groupidentify");
    expect(evs[2].$groups).toEqual({ company: "acme" });
  });
});

describe("sessions", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_700_000_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("keeps a session while active, rotates after 30 min idle", () => {
    const s = new SessionManager(new MemStorage());
    const a = s.touch();
    vi.advanceTimersByTime(29 * 60_000);
    expect(s.touch().sessionId).toBe(a.sessionId);
    vi.advanceTimersByTime(29 * 60_000); // activity keeps it alive
    expect(s.touch().sessionId).toBe(a.sessionId);
    vi.advanceTimersByTime(31 * 60_000);
    const b = s.touch();
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(b.isNew).toBe(true);
    expect(b.windowId).toBe(a.windowId);
  });

  it("rotates after 24 h even if active", () => {
    const s = new SessionManager(new MemStorage());
    const a = s.touch();
    for (let i = 0; i < 25; i++) {
      vi.advanceTimersByTime(60 * 60_000);
      s.touch();
    }
    expect(s.touch().sessionId).not.toBe(a.sessionId);
  });

  it("rotates on UTM campaign change but not on first adoption", () => {
    const s = new SessionManager(new MemStorage());
    const a = s.touch();
    expect(s.touch("google|cpc").sessionId).toBe(a.sessionId);
    expect(s.touch("google|cpc").sessionId).toBe(a.sessionId);
    expect(s.touch("news|email").sessionId).not.toBe(a.sessionId);
  });

  it("is shared through storage between instances (tabs) with distinct windows", () => {
    const st = new MemStorage();
    const a = new SessionManager(st).touch();
    const b = new SessionManager(st).touch();
    expect(b.sessionId).toBe(a.sessionId);
    expect(b.windowId).not.toBe(a.windowId);
  });

  it("stamps session and window ids on events", () => {
    const { core } = make();
    const e = core.capture("x")!;
    expect(e.properties.$session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.properties.$window_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("onCaptured", () => {
  it("observes captured events", () => {
    const seen: string[] = [];
    const { core } = make();
    core.onCaptured((e) => seen.push(e.event));
    core.capture("x");
    expect(seen).toEqual(["x"]);
  });
});

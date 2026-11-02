import { describe, expect, it } from "vitest";
import { Core, SessionManager } from "../src/index.js";
import type { CoreConfig } from "../src/index.js";
import { FakeTransport, MemStorage } from "./helpers.js";

function make(over: Partial<CoreConfig> = {}) {
  const transport = new FakeTransport();
  const storage = new MemStorage();
  let t = 1_000_000;
  const clock = { now: () => t };
  const core = new Core({ apiKey: "lc_pk_test", apiHost: "https://h", transport, storage, library: { name: "t", version: "1" }, clock, ...over });
  return { core, transport, storage, advance: (ms: number) => (t += ms) };
}

describe("session definition from the remote config (N-ANA-6)", () => {
  it("applies idle timeout, max length and new-session events", () => {
    const { core, advance } = make();
    core.applyRemote({ session_idle_minutes: 5, session_max_minutes: 60, session_new_on_events: ["login"] });
    const a = core.capture("a")!.properties.$session_id;
    advance(4 * 60_000);
    expect(core.capture("b")!.properties.$session_id).toBe(a);
    advance(6 * 60_000);
    const c = core.capture("c")!.properties.$session_id;
    expect(c).not.toBe(a);
    const login = core.capture("login")!.properties.$session_id;
    expect(login).not.toBe(c);
    expect(core.capture("after")!.properties.$session_id).toBe(login);
  });

  it("values passed in code win and bad remote values are ignored", () => {
    const storage = new MemStorage();
    let t = 0;
    const s = new SessionManager(storage, { idleMs: 60_000, clock: { now: () => t } });
    s.configure({ session_idle_minutes: 120, session_max_minutes: 0, session_new_on_events: ["x"] });
    const a = s.touch().sessionId;
    t = 61_000;
    expect(s.touch().sessionId).not.toBe(a);
    expect(s.touch(undefined, "x").isNew).toBe(true);
  });
});

describe("geo consent default (N-ANA-17)", () => {
  it("writes nothing and sends nothing until the geo default arrives", async () => {
    const { core, transport, storage } = make({ consent: { awaitRemote: true } });
    core.capture("early");
    core.register({ k: 1 });
    await core.flush();
    expect(storage.writes).toBe(0);
    expect(transport.calls).toHaveLength(0);
    core.applyRemote({ consent_default: "opt_out" });
    expect(storage.writes).toBeGreaterThan(0);
    await core.flush();
    expect(transport.events().map((e) => e.event)).toEqual(["early"]);
    expect(core.consentStatus()).toBe("pending");
  });

  it("opt_in rule keeps everything back until the visitor decides", async () => {
    const { core, transport, storage } = make({ consent: { awaitRemote: true, mode: "opt_out", queueBeforeConsent: true } });
    core.capture("early");
    core.applyRemote({ consent_default: "opt_in" });
    expect(core.consent.mode).toBe("opt_in");
    core.capture("still-held");
    await core.flush();
    expect(storage.writes).toBe(0);
    expect(transport.calls).toHaveLength(0);
    core.optIn();
    await core.flush();
    expect(transport.events().map((e) => e.event)).toEqual(["early", "still-held", "$opt_in"]);
  });

  it("cookieless rule sends events without ids and stores nothing", async () => {
    const { core, transport, storage } = make({ consent: { awaitRemote: true } });
    core.identify("user-1");
    core.capture("early");
    core.applyRemote({ consent_default: "cookieless" });
    core.capture("later", {}, { $set: { plan: "pro" } });
    await core.flush();
    expect(storage.writes).toBe(0);
    const evs = transport.events();
    expect(evs.map((e) => e.event)).toEqual(["early", "later"]);
    for (const e of evs) {
      expect(e.distinct_id).toBeUndefined();
      expect((e as { $set?: unknown }).$set).toBeUndefined();
    }
  });

  it("no matching rule keeps the local mode; a stored decision never waits", () => {
    const { core } = make({ consent: { awaitRemote: true, mode: "opt_out" } });
    core.applyRemote({});
    expect(core.hasConsent("analytics")).toBe(true);
    const storage = new MemStorage();
    storage.set("lc_consent", JSON.stringify({ analytics: false, replay: false, marketing: false }));
    const decided = new Core({ apiKey: "k", apiHost: "https://h", transport: new FakeTransport(), storage, library: { name: "t", version: "1" }, consent: { awaitRemote: true } });
    expect(decided.consent.resolving).toBe(false);
    decided.applyRemote({ consent_default: "opt_out" });
    expect(decided.hasConsent("analytics")).toBe(false);
  });
});

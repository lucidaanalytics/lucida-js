import { describe, expect, it } from "vitest";
import { Core } from "../src/index.js";
import type { CoreConfig } from "../src/index.js";
import { FakeTransport, MemStorage } from "./helpers.js";

function make(over: Partial<CoreConfig> = {}) {
  const transport = new FakeTransport();
  const core = new Core({ apiKey: "k", apiHost: "https://h", transport, storage: new MemStorage(), library: { name: "t", version: "1" }, ...over });
  return { core, transport };
}

describe("core extras", () => {
  it("reset({reuseAnonymousId}) keeps the device's first anonymous id; resetDeviceId rotates the device id", () => {
    const { core } = make();
    const anon = core.distinctId;
    const device = core.deviceId;
    core.identify("u1");
    core.reset({ reuseAnonymousId: true });
    expect(core.distinctId).toBe(anon);
    expect(core.deviceId).toBe(device);
    core.reset({ resetDeviceId: true });
    expect(core.distinctId).not.toBe(anon);
    expect(core.deviceId).not.toBe(device);
  });

  it("adopts a bootstrapped session id only when none is stored, and honours idle/max limits", () => {
    const t = { n: 1_000 };
    const { core } = make({ session: { bootstrapId: "boot", idleMs: 60_000 }, clock: { now: () => t.n } });
    expect(core.sessionId).toBe("boot");
    expect(core.sessionStart).toBe(1_000);
    t.n += 50;
    expect(core.sessionId).toBe("boot");
    t.n += 70_000;
    expect(core.sessionId).not.toBe("boot");
  });

  it("onSessionId fires on first touch, on rotation and after reset; unsubscribe works", () => {
    const t = { n: 1_000 };
    const { core } = make({ session: { idleMs: 60_000 }, clock: { now: () => t.n } });
    const seen: string[] = [];
    const off = core.onSessionId((s) => seen.push(s));
    const a = core.sessionId;
    core.sessionId;
    t.n += 70_000;
    const b = core.sessionId;
    core.reset();
    const c = core.sessionId;
    expect(seen).toEqual([a, b, c]);
    off();
    t.n += 70_000;
    core.sessionId;
    expect(seen).toHaveLength(3);
  });

  it("bootstrapIdentified makes identify(sameId) a no-op without an anon link", () => {
    const { core, transport } = make({ bootstrapDistinctId: "u1", bootstrapIdentified: true });
    core.identify("u1");
    expect(core.queue.size).toBe(0);
    expect(transport.calls).toEqual([]);
  });

  it("capture timestamp override; invalid falls back to now; getProperty reads super props", () => {
    const { core } = make({ clock: { now: () => Date.parse("2026-01-01T00:00:00Z") } });
    expect(core.capture("a", {}, { timestamp: "2020-05-05T00:00:00.000Z" })?.timestamp).toBe("2020-05-05T00:00:00.000Z");
    expect(core.capture("b", {}, { timestamp: new Date(NaN) })?.timestamp).toBe("2026-01-01T00:00:00.000Z");
    core.register({ k: 1 });
    expect(core.getProperty("k")).toBe(1);
  });
});

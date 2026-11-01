import { describe, expect, it } from "vitest";
import { Core } from "../src/index.js";
import type { CoreConfig } from "../src/index.js";
import { FakeTransport, MemStorage } from "./helpers.js";

function make(over: Partial<CoreConfig> = {}, storage = new MemStorage()) {
  const transport = new FakeTransport();
  const core = new Core({ apiKey: "lc_pk_test", apiHost: "https://h", transport, storage, library: { name: "t", version: "1" }, ...over });
  return { core, transport, storage };
}

describe("consent status", () => {
  it("is pending until a decision, then granted or denied, and survives reload", () => {
    const storage = new MemStorage();
    const { core } = make({ consent: { mode: "opt_out" } }, storage);
    expect(core.consentStatus()).toBe("pending");
    expect(core.hasConsent("analytics")).toBe(true);
    core.optOut();
    expect(core.consentStatus()).toBe("denied");
    expect(make({ consent: { mode: "opt_out" } }, storage).core.consentStatus()).toBe("denied");
    core.optIn();
    expect(core.consentStatus()).toBe("granted");
  });

  it("uses a custom storage key", () => {
    const storage = new MemStorage();
    const { core } = make({ consent: { mode: "opt_in", storageKey: "my_consent" } }, storage);
    core.optIn();
    expect(storage.get("my_consent")).toContain('"analytics":true');
    expect(storage.get("lc_consent")).toBeNull();
  });
});

describe("cookielessOnReject", () => {
  it("sends anonymous events after a decline, withholds identity, writes nothing", async () => {
    const storage = new MemStorage();
    const { core, transport } = make({ consent: { mode: "opt_in", cookielessOnReject: true } }, storage);
    expect(core.capture("before")).toBeUndefined(); // pending: nothing
    core.setConsent({ analytics: false });
    const writes = storage.writes;
    core.capture("$pageview", {}, { $set: { plan: "pro" } });
    core.identify("user-1");
    core.alias("other");
    await core.flush();
    const ev = transport.events();
    expect(ev.map((e) => e.event)).toEqual(["$pageview"]);
    expect(ev[0]).not.toHaveProperty("distinct_id");
    expect(ev[0]).not.toHaveProperty("$set");
    expect(storage.writes).toBe(writes);

    core.optIn();
    core.capture("after");
    await core.flush();
    const after = transport.events().find((e) => e.event === "after")!;
    expect(after.distinct_id).toBe("user-1");
  });

  it("is off by default: a decline drops events", () => {
    const { core } = make({ consent: { mode: "opt_in" } });
    core.setConsent({ analytics: false });
    expect(core.capture("x")).toBeUndefined();
  });
});

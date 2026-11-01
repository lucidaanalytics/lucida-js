import { describe, expect, it } from "vitest";
import { Core } from "../src/index.js";
import type { CoreConfig, WireEvent } from "../src/index.js";
import { FakeTransport, MemStorage } from "./helpers.js";

function make(over: Partial<CoreConfig> = {}) {
  const transport = new FakeTransport();
  const storage = new MemStorage();
  const core = new Core({ apiKey: "k", apiHost: "https://h", transport, storage, library: { name: "t", version: "1" }, ...over });
  return { core, transport, storage };
}

describe("core filter", () => {
  it("listeners and the queue see only what the filter returns", async () => {
    const { core, transport } = make();
    const seen: string[] = [];
    core.onCaptured((e) => seen.push(e.event));
    core.setFilter((e: WireEvent) => (e.event === "drop" ? null : { ...e, properties: { ...e.properties, tagged: 1 } }));
    expect(core.capture("drop")).toBeUndefined();
    expect(core.capture("keep")?.properties.tagged).toBe(1);
    await core.flush();
    expect(seen).toEqual(["keep"]);
    expect(transport.events().map((e) => e.event)).toEqual(["keep"]);
    expect(transport.events()[0]!.properties.tagged).toBe(1);
  });

  it("also runs for events held before consent, so the SDK policy (beforeSend, personProfiles) covers them", async () => {
    const { core, transport } = make({ consent: { mode: "opt_in", queueBeforeConsent: true } });
    core.setFilter((e: WireEvent) => (e.event === "drop" ? null : { ...e, properties: { ...e.properties, tagged: 1 } }));
    core.capture("drop");
    core.capture("held");
    core.optIn();
    await core.flush();
    const held = transport.events().filter((e) => e.event !== "$opt_in");
    expect(held.map((e) => e.event)).toEqual(["held"]);
    expect(held[0]!.properties.tagged).toBe(1);
  });
});

describe("persisted properties and consent storage", () => {
  it("persists only the accepted super properties; all of them still ride on events", () => {
    const { core, storage } = make({ persistProperty: (k) => k === "plan" });
    core.register({ plan: "pro", secret: "page-only" });
    expect(JSON.parse(storage.get("lc_props")!)).toEqual({ plan: "pro" });
    expect(core.capture("e")?.properties).toMatchObject({ plan: "pro", secret: "page-only" });
  });

  it("keeps the consent decision in its own storage", () => {
    const consentStorage = new MemStorage();
    const { core, storage } = make({ consentStorage, consent: { mode: "opt_in" } });
    core.optIn();
    expect(consentStorage.get("lc_consent")).toContain('"analytics":true');
    expect(storage.get("lc_consent")).toBeNull();
  });
});

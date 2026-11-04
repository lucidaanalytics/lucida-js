import { afterEach, describe, expect, it } from "vitest";
import { clickIdTracker } from "../src/clickids.js";
import { createClient } from "../src/client.js";
import { fakeTransport } from "./helpers.js";

const mem = () => {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), remove: (k: string) => void m.delete(k), m };
};

afterEach(() => history.replaceState({}, "", "/"));

describe("click-id tracker (LC-WEB-12)", () => {
  it("also knows Reddit, Pinterest, Quora, Snap, Impact and Kochava ids", () => {
    history.replaceState({}, "", "/?rdt_cid=R&epik=E&qclid=Q&sccid=S&irclid=I&_kx=K");
    expect(clickIdTracker(mem(), 90)()).toEqual({ rdt_cid: "R", epik: "E", qclid: "Q", sccid: "S", irclid: "I", _kx: "K" });
  });

  it("captures all supported ids, keeps them 90 days, then drops them", () => {
    let t = 1_000;
    const s = mem();
    const track = clickIdTracker(s, 90, () => t);
    history.replaceState({}, "", "/?gclid=G&gbraid=GB&wbraid=WB&fbclid=F&msclkid=M&ttclid=T&li_fat_id=L&twclid=X");
    expect(track()).toEqual({ gclid: "G", gbraid: "GB", wbraid: "WB", fbclid: "F", msclkid: "M", ttclid: "T", li_fat_id: "L", twclid: "X" });
    history.replaceState({}, "", "/other");
    t += 89 * 86_400_000;
    expect(Object.keys(track())).toHaveLength(8);
    t += 2 * 86_400_000;
    expect(track()).toEqual({});
  });

  it("a newer landing replaces the same id (last touch) and refreshes the expiry", () => {
    let t = 0;
    const track = clickIdTracker(mem(), 90, () => t);
    history.replaceState({}, "", "/?gclid=OLD");
    track();
    t += 80 * 86_400_000;
    history.replaceState({}, "", "/?gclid=NEW");
    track();
    t += 80 * 86_400_000;
    history.replaceState({}, "", "/x");
    expect(track()).toEqual({ gclid: "NEW" });
  });
});

describe("click ids on events", () => {
  it("adds $click_ids to every event and $initial_/$last_ person props to $pageview", async () => {
    history.replaceState({}, "", "/lp?gclid=G1&twclid=TW1");
    const t = fakeTransport();
    const c = createClient("k", { persistence: "memory", transport: t, offlineQueue: false });
    c.capture("signup");
    c.capture("$pageview");
    await c.flush();
    const ev = t.events();
    expect(ev.find((e) => e.event === "signup")!.properties.$click_ids).toEqual({ gclid: "G1", twclid: "TW1" });
    const pv = ev.find((e) => e.event === "$pageview") as unknown as { $set: Record<string, string>; $set_once: Record<string, string> };
    expect(pv.$set).toMatchObject({ $last_gclid: "G1", $last_twclid: "TW1" });
    expect(pv.$set_once).toMatchObject({ $initial_gclid: "G1", $initial_twclid: "TW1" });
    await c.shutdown();
  });

  it("nothing is read while consent is pending (events are dropped); ids landed on are kept once granted", async () => {
    history.replaceState({}, "", "/lp?fbclid=F9");
    const t = fakeTransport();
    const c = createClient("k", { persistence: "memory", transport: t, offlineQueue: false, consent: { mode: "opt_in" } });
    c.capture("early");
    c.setConsent({ analytics: true }); // the $opt_in event is the first one enriched
    history.replaceState({}, "", "/next");
    c.capture("later");
    await c.flush();
    expect(t.events().find((e) => e.event === "early")).toBeUndefined();
    expect(t.events().find((e) => e.event === "later")!.properties.$click_ids).toEqual({ fbclid: "F9" });
    await c.shutdown();
  });

  it("clickIds:false switches it off", async () => {
    history.replaceState({}, "", "/lp?gclid=G1");
    const t = fakeTransport();
    const c = createClient("k", { persistence: "memory", transport: t, offlineQueue: false, clickIds: false });
    c.capture("x");
    await c.flush();
    expect(t.events().find((e) => e.event === "x")!.properties.$click_ids).toBeUndefined();
    await c.shutdown();
  });
});

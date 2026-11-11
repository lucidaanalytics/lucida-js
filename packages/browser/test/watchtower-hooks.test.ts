import { afterEach, describe, expect, it } from "vitest";
import { correlate } from "../src/watchtower/correlate.js";
import type { Client, WatchtowerLike } from "../src/index.js";
import { startWith, tick } from "./helpers.js";

type Cb = (p: never) => void;
function fakeWt(withOn = true) {
  const subs: Record<string, Cb[]> = {};
  const wt = {
    setAttribute: () => {},
    ...(withOn
      ? { on: (ev: string, cb: Cb) => ((subs[ev] ??= []).push(cb), () => void (subs[ev] = (subs[ev] ?? []).filter((x) => x !== cb))) }
      : {}),
  } as WatchtowerLike;
  const fire = (ev: string, p: unknown) => (subs[ev] ?? []).forEach((cb) => cb(p as never));
  return { wt, fire, count: (ev: string) => (subs[ev] ?? []).length };
}
const vital = (name: string, value: number, rating: string, nav = "n1", final = true) => ({
  name,
  value,
  rating,
  navigation_id: nav,
  url: "https://x.test/p",
  final,
});

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  delete (globalThis as { watchtower?: unknown }).watchtower;
});
const sent = async (c: Client, t: ReturnType<typeof startWith>["t"]) => (await c.flush(), t.events());

describe("watchtower hooks", () => {
  it("records errors as $exception_seen, message capped, wt_issue_id kept when present", async () => {
    const { wt, fire } = fakeWt();
    const { client, t } = startWith([correlate], { watchtower: { client: wt } });
    live = client;
    await tick(20);
    fire("error", { event_id: "e1", trace_id: "t1", message: "x".repeat(400), handled: false });
    fire("error", { event_id: "e2", message: "m", handled: true, issue_id: "i9" });
    const ev = (await sent(client, t)).filter((e) => e.event === "$exception_seen");
    expect(ev[0]!.properties).toMatchObject({ wt_event_id: "e1", wt_trace_id: "t1", handled: false });
    expect(String(ev[0]!.properties.message)).toHaveLength(300);
    expect(ev[1]!.properties).toMatchObject({ wt_issue_id: "i9" });
  });

  it("emits one $web_vitals per navigation once all five are final, never twice", async () => {
    const { wt, fire } = fakeWt();
    const { client, t } = startWith([correlate], { watchtower: { client: wt } });
    live = client;
    await tick(20);
    for (const [n, v, r] of [
      ["LCP", 2000, "good"],
      ["INP", 300, "needs-improvement"],
      ["CLS", 0.3, "poor"],
      ["FCP", 900, "good"],
      ["TTFB", 100, "good"],
    ] as const)
      fire("vital", vital(n, v, r));
    fire("vital", vital("LCP", 2100, "good")); // after emit: ignored
    window.dispatchEvent(new Event("pagehide"));
    const ev = (await sent(client, t)).filter((e) => e.event === "$web_vitals");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.properties).toMatchObject({ lcp_ms: 2000, inp_ms: 300, cls: 0.3, fcp_ms: 900, ttfb_ms: 100, rating_worst: "poor" });
    expect(ev[0]!.properties.$current_url).toBeTruthy();
  });

  it("flushes a partial page view on pagehide, once", async () => {
    const { wt, fire } = fakeWt();
    const { client, t } = startWith([correlate], { watchtower: { client: wt } });
    live = client;
    await tick(20);
    fire("vital", vital("LCP", 1500, "good", "n2", false));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    const ev = (await sent(client, t)).filter((e) => e.event === "$web_vitals");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.properties).toMatchObject({ lcp_ms: 1500, rating_worst: "good" });
  });

  it("does nothing when the client has no hooks", async () => {
    const { wt } = fakeWt(false);
    const { client, t } = startWith([correlate], { watchtower: { client: wt } });
    live = client;
    await tick(20);
    const ev = await sent(client, t);
    expect(ev.filter((e) => e.event === "$exception_seen" || e.event === "$web_vitals")).toHaveLength(0);
  });

  it("picks up a client that appears later via watchtower:ready, and unsubscribes on shutdown", async () => {
    const { wt, fire, count } = fakeWt();
    const { client, t } = startWith([correlate]);
    live = client;
    await tick(20);
    await tick(5);
    (globalThis as { watchtower?: unknown }).watchtower = wt;
    window.dispatchEvent(new Event("watchtower:ready"));
    fire("error", { event_id: "late", message: "m", handled: false });
    expect((await sent(client, t)).some((e) => e.properties.wt_event_id === "late")).toBe(true);
    expect(count("error")).toBe(1);
    await client.shutdown();
    live = undefined;
    expect(count("error")).toBe(0);
  });

  it("subscribes nothing before consent", async () => {
    const { wt, count } = fakeWt();
    const { client } = startWith([correlate], { watchtower: { client: wt }, consent: { mode: "opt_in" } });
    live = client;
    await tick(20);
    expect(count("error")).toBe(0);
    client.setConsent({ analytics: true });
    await tick(5);
    expect(count("error")).toBe(1);
  });
});

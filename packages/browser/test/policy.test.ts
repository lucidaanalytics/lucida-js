import { afterEach, describe, expect, it } from "vitest";
import type { WireEvent } from "@lucida-analytics/sdk-core";
import { denylistHook, runHooks, sampleHook } from "../src/policy.js";
import { rateLimiter } from "../src/ratelimit.js";
import type { Client } from "../src/index.js";
import { start, tick } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
});

const base = { capturePageview: false, autocapture: false } as const;
const ev = (event = "x", properties: Record<string, unknown> = {}): WireEvent => ({ uuid: "u", event, timestamp: "t", properties });

describe("beforeSend chain", () => {
  it("runs hooks in order on the previous output; null drops; a throwing or non-event-returning hook drops the event (fail closed)", () => {
    const log: unknown[] = [];
    const out = runHooks(
      [
        (e) => ({ ...e, properties: { ...e.properties, a: 1 } }),
        () => {
          throw new Error("boom");
        },
        (e) => ({ ...e, properties: { ...e.properties, b: (e.properties.a as number) + 1 } }),
      ],
      ev(),
      (...a) => log.push(a),
    );
    expect(out).toBeNull();
    expect(log).toHaveLength(1);
    expect(runHooks([(e) => ({ ...e, properties: { n: 1 } }), (e) => ({ ...e, properties: { ...e.properties, m: 2 } })], ev(), () => {})?.properties).toEqual({ n: 1, m: 2 });
    expect(runHooks([(() => true) as never], ev(), () => {})).toBeNull();
    expect(runHooks([() => null, () => ev("never")], ev(), () => {})).toBeNull();
  });

  it("amends and rejects events from the client config (single hook or array)", async () => {
    const { client, t } = start({
      ...base,
      beforeSend: [(e) => (e.event === "secret" ? null : e), (e) => ({ ...e, properties: { ...e.properties, tagged: true } })],
    });
    live = client;
    client.capture("secret");
    client.capture("ok");
    await client.flush();
    const sent = t.events().filter((e) => !e.event.startsWith("$"));
    expect(sent.map((e) => e.event)).toEqual(["ok"]);
    expect(sent[0]!.properties.tagged).toBe(true);
  });

  it("sampleHook stamps $sample_rate on survivors and drops the rest", () => {
    expect(sampleHook(0.5, () => 0.1)(ev())?.properties.$sample_rate).toBe(0.5);
    expect(sampleHook(0.5, () => 0.9)(ev())).toBeNull();
    expect(sampleHook(0)(ev())).toBeNull();
    expect(sampleHook(1)(ev())?.properties.$sample_rate).toBeUndefined();
  });

  it("sampleRate: 0 drops everything", async () => {
    const { client, t } = start({ ...base, sampleRate: 0 });
    live = client;
    client.capture("a");
    await client.flush();
    expect(t.events()).toEqual([]);
  });

  it("propertyDenylist strips properties and person properties", async () => {
    const { client, t } = start({ ...base, propertyDenylist: ["email", "$screen_width"] });
    live = client;
    client.capture("a", { email: "x@y.z", keep: 1 });
    client.identify("u1", { email: "x@y.z", plan: "pro" });
    await client.flush();
    const [a, id] = t.events();
    expect(a!.properties.email).toBeUndefined();
    expect(a!.properties.$screen_width).toBeUndefined();
    expect(a!.properties.keep).toBe(1);
    expect(id!.event).toBe("$identify");
    expect((id as unknown as { $set: object }).$set).toEqual({ plan: "pro" });
    expect(denylistHook(["a"])(ev("e", { a: 1, b: 2 }))?.properties).toEqual({ b: 2 });
  });
});

describe("personProfiles", () => {
  it("identified_only: personless until identify, then normal; reset goes back", async () => {
    const { client, t } = start({ ...base, personProfiles: "identified_only" });
    live = client;
    client.capture("before");
    client.identify("user-1");
    client.capture("after");
    client.reset();
    client.capture("anon-again");
    await client.flush();
    const by = Object.fromEntries(t.events().map((e) => [e.event, e]));
    expect(by.before!.properties.$process_person_profile).toBe(false);
    expect(by.$identify!.properties.$process_person_profile).toBeUndefined();
    expect(by.after!.properties.$process_person_profile).toBeUndefined();
    expect(by["anon-again"]!.properties.$process_person_profile).toBe(false);
  });

  it("identified_only: setPersonProperties, group and alias each switch person processing on", async () => {
    for (const act of [(c: Client) => c.setPersonProperties({ a: 1 }), (c: Client) => c.group("org", "o1"), (c: Client) => c.alias("al")]) {
      const { client, t } = start({ ...base, personProfiles: "identified_only" });
      act(client);
      client.capture("next");
      await client.flush();
      expect(t.events().find((e) => e.event === "next")!.properties.$process_person_profile).toBeUndefined();
      await client.shutdown();
    }
  });

  it("identified_only: person writes riding on personless events are not sent", async () => {
    const { client, t } = start({ capturePageview: true, autocapture: false, personProfiles: "identified_only" });
    live = client;
    await client.flush();
    const pv = t.events().find((e) => e.event === "$pageview")!;
    expect(pv.properties.$process_person_profile).toBe(false);
    expect(pv.$set_once).toBeUndefined();
  });

  it("never: events are personless and identify / alias / setPersonProperties do nothing", async () => {
    const { client, t } = start({ ...base, personProfiles: "never" });
    live = client;
    client.identify("user-1", { a: 1 });
    client.alias("al");
    client.setPersonProperties({ a: 1 });
    client.unsetPersonProperties(["a"]);
    client.group("org", "o1");
    client.capture("e");
    await client.flush();
    const names = t.events().map((e) => e.event);
    expect(names).toEqual(["$groupidentify", "e"]);
    expect(t.events()[1]!.properties.$process_person_profile).toBe(false);
  });

  it("always (default) never adds the flag; bootstrap isIdentified counts as identified", async () => {
    const a = start({ ...base });
    a.client.capture("e");
    await a.client.flush();
    expect(a.t.events()[0]!.properties.$process_person_profile).toBeUndefined();
    await a.client.shutdown();
    const b = start({ ...base, personProfiles: "identified_only", bootstrap: { distinctId: "u9", isIdentified: true } });
    live = b.client;
    b.client.capture("e");
    await b.client.flush();
    expect(b.t.events()[0]!.properties.$process_person_profile).toBeUndefined();
  });
});

describe("rate limiting", () => {
  it("token bucket: burst, refill over time, cap", () => {
    let now = 0;
    const take = rateLimiter({ eventsPerSecond: 2, burst: 3 }, () => now);
    expect([take(), take(), take(), take()]).toEqual([true, true, true, false]);
    now += 500; // +1 token
    expect([take(), take()]).toEqual([true, false]);
    now += 60_000; // refills only up to the burst
    expect([take(), take(), take(), take()]).toEqual([true, true, true, false]);
  });

  it("drops events beyond the burst when configured, off by default", async () => {
    const { client, t } = start({ ...base, rateLimit: { eventsPerSecond: 0.001, burst: 2 } });
    live = client;
    await tick(20);
    for (let i = 0; i < 5; i++) client.capture(`e${i}`);
    await client.flush();
    expect(t.events().map((e) => e.event).filter((e) => !e.startsWith("$$"))).toEqual(["e0", "e1"]); // the drop warning is not rate limited
  });
});

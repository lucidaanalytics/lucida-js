import type { Client } from "@lucida/browser";
import { describe, expect, it } from "vitest";
import { LucidaService, provideLucida } from "../src/index.js";

type FlagCb = (f: Record<string, boolean | string>) => void;

function fake() {
  const calls: string[] = [];
  let cb: FlagCb = () => {};
  const client = {
    capture: (e: string) => calls.push(`capture:${e}`),
    identify: (id: string) => calls.push(`identify:${id}`),
    setConsent: () => calls.push("consent"),
    getFlag: (k: string) => k === "beta",
    isFeatureEnabled: () => true,
    onFlags: (f: FlagCb) => ((cb = f), () => calls.push("unsub")),
    replay: { tag: (n: string) => calls.push(`tag:${n}`) },
  } as unknown as Client;
  return { client, calls, push: (f: Record<string, boolean | string>) => cb(f) };
}

describe("@lucida/angular", () => {
  it("provideLucida returns a provider literal that builds the service", () => {
    const f = fake();
    const [p] = provideLucida({ client: f.client });
    expect(p!.provide).toBe(LucidaService);
    const svc = p!.useFactory();
    svc.capture("x");
    svc.identify("u1");
    svc.replay?.tag("t");
    expect(f.calls).toEqual(["capture:x", "identify:u1", "tag:t"]);
    expect(svc.isFeatureEnabled("beta")).toBe(true);
  });

  it("flags$ emits the bootstrap value then reloads; flag$ only on change; unsubscribe and ngOnDestroy clean up", () => {
    const f = fake();
    const svc = new LucidaService({ client: f.client, bootstrapFlags: { beta: "a" } });
    const all: unknown[] = [];
    const one: unknown[] = [];
    const sub = svc.flags$.subscribe((v) => all.push(v));
    svc.flag$("beta").subscribe((v) => one.push(v));
    f.push({ beta: "a", other: true });
    f.push({ beta: "b" });
    expect(all).toEqual([{ beta: "a" }, { beta: "a", other: true }, { beta: "b" }]);
    expect(one).toEqual(["a", "b"]);
    sub.unsubscribe();
    f.push({ beta: "c" });
    expect(all).toHaveLength(3);
    svc.ngOnDestroy();
    expect(f.calls).toContain("unsub");
  });

  it("builds the browser client from apiKey (disabled: no network) and is inert without window or key", () => {
    const svc = new LucidaService({ apiKey: "lc_pk_x", options: { disabled: true, persistence: "memory" } });
    expect(svc.client).not.toBeNull();
    expect(svc.isFeatureEnabled("nope")).toBe(false);
    const none = new LucidaService({});
    expect(none.client).toBeNull();
    none.capture("x");
    none.identify("u");
    expect(none.replay).toBeUndefined();
    expect(none.getFlag("a")).toBeUndefined();
  });
});

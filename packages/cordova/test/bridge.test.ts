import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

const lucida = createRequire(import.meta.url)("../www/lucida.js") as Record<string, (...a: unknown[]) => Promise<unknown>>;

type Call = { service: string; action: string; args: unknown[] };
let calls: Call[];
let reply: (c: Call) => { ok?: unknown; fail?: unknown };

beforeEach(() => {
  calls = [];
  reply = () => ({ ok: undefined });
  (globalThis as { cordova?: unknown }).cordova = {
    exec(ok: (v: unknown) => void, fail: (e: unknown) => void, service: string, action: string, args: unknown[]) {
      const c = { service, action, args };
      calls.push(c);
      const r = reply(c);
      if (r.fail !== undefined) fail(r.fail);
      else ok(r.ok);
    },
  };
});

describe("cordova bridge", () => {
  it("routes capture to the Lucida service and strips $lc_ props", async () => {
    await lucida.capture!("buy", { plan: "pro", $lc_org: "evil" });
    expect(calls).toEqual([{ service: "Lucida", action: "capture", args: ["buy", { plan: "pro" }] }]);
  });

  it("passes identify set and setOnce, alias, group, reset", async () => {
    await lucida.identify!("u1", { a: 1, $lc_x: 1 }, { b: 2 });
    await lucida.alias!("old");
    await lucida.group!("org", "acme", { seats: 3 });
    await lucida.reset!();
    expect(calls.map((c) => [c.action, c.args])).toEqual([
      ["identify", ["u1", { a: 1 }, { b: 2 }]],
      ["alias", ["old"]],
      ["group", ["org", "acme", { seats: 3 }]],
      ["reset", []],
    ]);
  });

  it("rejects bad arguments without calling native", async () => {
    await expect(lucida.capture!("")).rejects.toThrow(/event/);
    await expect(lucida.init!("k", { consent: { mode: "maybe" } })).rejects.toThrow(/consent.mode/);
    expect(calls).toEqual([]);
  });

  it("returns native values for flags and consent", async () => {
    reply = (c) => ({ ok: { getFlag: "variant-a", isFeatureEnabled: true, isOptedOut: false, getFlagPayload: { n: 1 } }[c.action] });
    expect(await lucida.getFlag!("f")).toBe("variant-a");
    expect(await lucida.isFeatureEnabled!("f")).toBe(true);
    expect(await lucida.getFlagPayload!("f")).toEqual({ n: 1 });
    expect(await lucida.isOptedOut!()).toBe(false);
  });

  it("rejects with an Error when native fails", async () => {
    reply = () => ({ fail: "not initialised" });
    await expect(lucida.flush!()).rejects.toThrow("not initialised");
  });

  it("rejects when cordova.exec is missing", async () => {
    delete (globalThis as { cordova?: unknown }).cordova;
    await expect(lucida.flush!()).rejects.toThrow(/cordova.exec/);
  });

  it("bridges replay controls and setConsent", async () => {
    await lucida.startReplay!();
    await lucida.pauseReplay!();
    await lucida.resumeReplay!();
    await lucida.stopReplay!();
    await lucida.setConsent!({ replay: false });
    expect(calls.map((c) => c.action)).toEqual(["startReplay", "pauseReplay", "resumeReplay", "stopReplay", "setConsent"]);
    expect(calls[4]!.args).toEqual([{ replay: false }]);
  });

  it("onFlags resolves on registration and calls back on each refresh", async () => {
    const got: unknown[] = [];
    let push: (v: unknown) => void = () => undefined;
    (globalThis as { cordova?: unknown }).cordova = {
      exec(ok: (v: unknown) => void) {
        push = ok;
        ok(undefined);
      },
    };
    await lucida.onFlags!((f: unknown) => void got.push(f));
    push({ a: true });
    expect(got).toEqual([{ a: true }]);
  });
});

import { describe, expect, it } from "vitest";
import { offlineTransport } from "../src/index.js";
import { FakeTransport, MemStorage } from "./helpers.js";

const bodies = (st: MemStorage) => (JSON.parse(st.get("lc_offline")!) as Array<{ body: string }>).map((x) => x.body);

describe("offlineTransport", () => {
  it("parks failed batches and replays them on drain", async () => {
    const inner = new FakeTransport();
    inner.statuses = [0];
    const st = new MemStorage();
    const t = offlineTransport(inner, st, { retryMs: 1e9 });
    expect(await t.send("u", "b1")).toEqual({ status: 200 });
    expect(bodies(st)).toEqual(["b1"]);
    await t.drain();
    expect(inner.calls.map((c) => c.body)).toEqual(["b1", "b1"]);
    expect(st.get("lc_offline")).toBeNull();
  });
  it("keeps the rest when drain hits a failure, and bounds storage", async () => {
    const inner = new FakeTransport();
    const st = new MemStorage();
    let on = false;
    const t = offlineTransport(inner, st, { isOnline: () => on, maxBatches: 2, retryMs: 1e9 });
    for (const b of ["a", "b", "c"]) await t.send("u", b);
    expect(inner.calls).toHaveLength(0);
    expect(bodies(st)).toEqual(["b", "c"]);
    on = true;
    inner.statuses = [200, 0];
    await t.drain();
    expect(bodies(st)).toEqual(["c"]);
  });
  it("passes non-network statuses through", async () => {
    const inner = new FakeTransport();
    inner.statuses = [400];
    const t = offlineTransport(inner, new MemStorage());
    expect(await t.send("u", "x")).toEqual({ status: 400 });
  });
});

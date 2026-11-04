import { describe, expect, it } from "vitest";
import { asyncStorageAdapter, createClient, createReplaySpool, memoryStorage } from "../src/index.js";
import type { AsyncStorageLike, NativeReplayModule, QueueCipher, SpoolEntry } from "../src/index.js";

const capture = (text = "****") =>
  JSON.stringify({
    width: 390,
    height: 844,
    events: [
      { type: 4, timestamp: 1, data: { href: "app://X", width: 390, height: 844 } },
      { type: 2, timestamp: 1, data: { node: { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: "html", childNodes: [{ type: 2, id: 3, tagName: "body", childNodes: [{ type: 3, id: 4, textContent: text }] }] }] } } },
    ],
  });

const rev: QueueCipher = {
  encrypt: (p) => "enc:" + [...p].reverse().join(""),
  decrypt: (c) => (c.startsWith("enc:") ? [...c.slice(4)].reverse().join("") : null),
};

/** A fake AsyncStorage that survives "restarts" (a new createClient over the same backing map). */
function fakeAsync(backing: Map<string, string>): AsyncStorageLike {
  return {
    multiGet: async (keys) => keys.map((k) => [k, backing.get(k) ?? null] as const),
    setItem: async (k, v) => void backing.set(k, v),
    removeItem: async (k) => void backing.delete(k),
    getAllKeys: async () => [...backing.keys()],
  };
}

async function boot(backing: Map<string, string>, status: { v: number }, posts: Array<{ seq: number }>, extra: Record<string, unknown> = {}) {
  const module = { async captureWireframe() { return module.out; }, out: capture() };
  let tick: () => void = () => {};
  const client = await createClient("lc_pk_x", {
    apiHost: "https://ingest.test",
    consent: { mode: "opt_out" },
    asyncStorage: fakeAsync(backing),
    transport: { send: async () => ({ status: 200 }) },
    fetch: (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/replay")) {
        if (status.v === 0) throw new Error("offline");
        posts.push(JSON.parse(String(init?.body)) as { seq: number });
        return { ok: true, status: status.v };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch,
    replay: { enabled: true, module: module as NativeReplayModule, useRemoteConfig: false, setInterval: (fn: () => void) => ((tick = fn), 1), clearInterval: () => {} },
    ...extra,
  } as never);
  const run = async () => {
    tick();
    await new Promise((r) => setTimeout(r, 10));
  };
  return { client, module, run };
}
const spilled = (b: Map<string, string>) => [...b.keys()].filter((k) => k.startsWith("lc_replay"));

describe("replay spool", () => {
  it("offline chunks spill to disk, survive a restart and upload in order", async () => {
    const backing = new Map<string, string>();
    const status = { v: 0 };
    const posts: Array<{ seq: number }> = [];
    const a = await boot(backing, status, posts);
    await a.run();
    a.module.out = capture("two");
    await a.run();
    expect(posts).toHaveLength(0);
    expect(spilled(backing)).toContain("lc_replay.0.0");
    expect(spilled(backing)).toContain("lc_replay.1.0");

    status.v = 200;
    const b = await boot(backing, status, posts); // restart: hydrated from the same AsyncStorage
    await b.run();
    expect(posts.slice(0, 2).map((p) => p.seq)).toEqual([0, 1]);
    expect(spilled(backing)).not.toContain("lc_replay");
  });

  it("a rejected chunk (4xx) is dropped, not retried forever", async () => {
    const backing = new Map<string, string>();
    const t = await boot(backing, { v: 400 }, []);
    await t.run();
    expect(spilled(backing)).toEqual([]);
  });

  it("spilled chunks are encrypted with the queue cipher", async () => {
    const backing = new Map<string, string>();
    const t = await boot(backing, { v: 0 }, [], { queueCipher: rev });
    await t.run();
    const body = backing.get("lc_replay.0.0") ?? "";
    expect(body.startsWith("enc:")).toBe(true);
    expect(body).not.toContain("session_id");
  });

  it("reset and optOut erase the spool", async () => {
    for (const erase of ["reset", "optOut"] as const) {
      const backing = new Map<string, string>();
      const t = await boot(backing, { v: 0 }, []);
      await t.run();
      expect(spilled(backing).length).toBeGreaterThan(0);
      t.client[erase]();
      await new Promise((r) => setTimeout(r, 5));
      expect(spilled(backing)).toEqual([]);
    }
  });

  it("over budget the oldest whole session goes and the loss is reported", () => {
    const s = memoryStorage();
    const dropped: string[] = [];
    const sp = createReplaySpool(s, 100, (sid, n, b) => dropped.push(`${sid}:${n}:${b}`));
    const body = "x".repeat(40);
    sp.add("a", 0, false, body);
    sp.add("a", 1, false, body);
    sp.add("b", 0, false, body);
    expect(dropped).toEqual(["a:2:80"]);
    expect(sp.entries().map((e) => e.sid)).toEqual(["b"]);
    expect(s.get("lc_replay.0.0")).toBeNull();
  });

  it("a reloaded spool resumes seq and ignores a corrupt index", () => {
    const s = memoryStorage();
    const a = createReplaySpool(s);
    a.add("a", 0, true, "{}");
    a.add("a", 1, true, "{}");
    const b = createReplaySpool(s);
    expect(b.entries()).toHaveLength(2);
    expect(b.nextSeq("a")).toBe(2);
    expect(b.nextSeq("z")).toBe(0);
    s.set("lc_replay", "not json");
    expect(createReplaySpool(s).entries()).toEqual([]);
  });

  it("asyncStorageAdapter hydrates spilled chunks when getAllKeys exists", async () => {
    const backing = new Map([["lc_replay", "[]"], ["lc_replay.3.0", "{}"], ["other", "x"]]);
    const a = asyncStorageAdapter(fakeAsync(backing));
    await a.ready;
    expect(a.storage.get("lc_replay.3.0")).toBe("{}");
    expect(a.storage.get("other")).toBeNull();
  });

  it("splits a chunk over 2 MB into parts under 1 MB and reads it back", () => {
    const s = memoryStorage();
    const big = JSON.stringify({ events: "é".repeat(2_500_000) });
    const sp = createReplaySpool(s, 50 * 1024 * 1024);
    sp.add("a", 0, false, big);
    const e = sp.entries()[0] as SpoolEntry;
    expect(e.p).toBeGreaterThan(8);
    for (let i = 0; i < e.p; i++) expect(new TextEncoder().encode(s.get(`lc_replay.${e.id}.${i}`) as string).length).toBeLessThan(1024 * 1024);
    expect(createReplaySpool(s, 50 * 1024 * 1024).read(e)).toBe(big); // after a restart
  });

  it("discards a torn write: a missing part, a short part, an unindexed leftover", () => {
    const s = memoryStorage();
    const sp = createReplaySpool(s, 50 * 1024 * 1024);
    sp.add("a", 0, false, "x".repeat(700_000));
    sp.add("a", 1, false, "y".repeat(700_000));
    const [one, two] = sp.entries() as SpoolEntry[];
    s.remove(`lc_replay.${one?.id}.1`); // part lost
    s.set(`lc_replay.${two?.id}.0`, "short"); // part truncated
    s.set("lc_replay.pending", "9:2");
    s.set("lc_replay.9.0", "orphan");
    const re = createReplaySpool(s, 50 * 1024 * 1024);
    expect(re.entries().map((e) => e.seq)).toEqual([1]); // the missing-part entry is gone at load
    expect(re.read(two as SpoolEntry)).toBeNull(); // the short part fails the length check
    expect(s.get("lc_replay.9.0")).toBeNull();
    expect(s.get(`lc_replay.${one?.id}.0`)).toBeNull();
  });
});

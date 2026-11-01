import { describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
const client = { capture: (...a: unknown[]) => calls.push(["capture", ...a]), identify: (...a: unknown[]) => calls.push(["identify", ...a]) };
vi.mock("../src/index.js", () => ({ init: (key: string, cfg: unknown) => (calls.push(["init", key, cfg]), client) }));

const { drain } = await import("../src/snippet.js");

describe("snippet loader", () => {
  it("runs queued commands in order, holds pre-init commands, then handles live pushes", () => {
    calls.length = 0;
    const w: { lucidaQueue?: [string, ...unknown[]][]; lucida?: unknown } = {
      lucidaQueue: [["capture", "early"], ["init", "lc_pk_1", { api_host: "h" }], ["identify", "u1"]],
    };
    drain(w as never);
    w.lucidaQueue!.push(["capture", "late", { a: 1 }]);
    expect(calls).toEqual([
      ["init", "lc_pk_1", { api_host: "h" }],
      ["capture", "early"],
      ["identify", "u1"],
      ["capture", "late", { a: 1 }],
    ]);
    expect(w.lucida).toBe(client);
  });

  it("loads `modules` from the versioned asset path before init, holding commands meanwhile", async () => {
    calls.length = 0;
    const urls: string[] = [];
    const replay = () => {};
    const importer = async (u: string) => (urls.push(u), u.endsWith("/replay.js") ? { replay } : {});
    const w: { lucidaQueue?: [string, ...unknown[]][]; lucida?: unknown } = {
      lucidaQueue: [["init", "k", { assetHost: "https://cdn.test/", modules: ["replay", "heatmaps"] }], ["capture", "x"]],
    };
    const done = drain(w as never, importer);
    expect(calls).toEqual([]);
    await done;
    expect(urls).toEqual(["https://cdn.test/static/v0.0.0/replay.js", "https://cdn.test/static/v0.0.0/heatmaps.js"]);
    expect(calls[0]![0]).toBe("init");
    expect(calls[1]).toEqual(["capture", "x"]);
  });

  it("extension mode never loads remote modules", async () => {
    calls.length = 0;
    const importer = vi.fn(async () => ({}));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = { lucidaQueue: [["init", "k", { extension: true, modules: ["replay"] }]] };
    await drain(w as never, importer);
    expect(importer).not.toHaveBeenCalled();
    expect(calls[0]![0]).toBe("init");
  });
});

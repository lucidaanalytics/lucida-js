import { describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
const client = { capture: (...a: unknown[]) => calls.push(["capture", ...a]), identify: (...a: unknown[]) => calls.push(["identify", ...a]) };
vi.mock("../src/index.js", () => ({ init: (key: string, cfg: unknown) => (calls.push(["init", key, cfg]), client) }));

const { drain } = await import("../src/snippet.js");
const { LIB_VERSION } = await import("../src/client.js");

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
    expect(urls).toEqual([`https://cdn.test/static/v${LIB_VERSION}/replay.js`, `https://cdn.test/static/v${LIB_VERSION}/heatmaps.js`]);
    expect(calls[0]![0]).toBe("init");
    expect(calls[1]).toEqual(["capture", "x"]);
  });

  describe("manifest (SRI)", () => {
    const body = "export const replay = () => 1;";
    const sri = async (s: string) => `sha384-${Buffer.from(await crypto.subtle.digest("SHA-384", new TextEncoder().encode(s))).toString("base64")}`;
    const boot = async (manifest: unknown, served: string) => {
      calls.length = 0;
      const urls: string[] = [];
      const importer = async (u: string) => (urls.push(u), { replay: () => {} });
      const fetchImpl = (async (u: string) => {
        if (u.endsWith("/manifest.json")) return manifest ? new Response(JSON.stringify(manifest)) : new Response("", { status: 404 });
        return new Response(served);
      }) as unknown as typeof fetch;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const w = { lucidaQueue: [["init", "k", { assetHost: "https://cdn.test", modules: ["replay"] }]] };
      await drain(w as never, importer, fetchImpl);
      const refused = warn.mock.calls.some((c) => String(c[1]).includes("refused"));
      warn.mockRestore();
      return { urls, refused };
    };

    it("runs a module whose hash matches the manifest", async () => {
      const r = await boot({ version: LIB_VERSION, files: { "modules/replay.js": await sri(body) } }, body);
      expect(r.urls).toHaveLength(1);
      expect(r.refused).toBe(false);
    });
    it("refuses a module that differs, or that the manifest does not list, and still starts the client", async () => {
      const bad = await boot({ version: LIB_VERSION, files: { "modules/replay.js": await sri(body) } }, body + "//evil");
      expect(bad.urls).toEqual([]);
      expect(bad.refused).toBe(true);
      expect(calls[0]![0]).toBe("init");
      const unlisted = await boot({ version: LIB_VERSION, files: {} }, body);
      expect(unlisted.urls).toEqual([]);
      expect(unlisted.refused).toBe(true);
    });
    it("without a manifest (an old deploy) loads as before", async () => {
      const r = await boot(undefined, "anything");
      expect(r.urls).toHaveLength(1);
      expect(r.refused).toBe(false);
    });
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

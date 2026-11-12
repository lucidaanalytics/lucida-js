import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { outPath, render, storagePath } from "../../../scripts/gen-embed-manifest.mjs";

type Entry = { name: string; type: string; category: string; lifetime: string; purpose: { en: string } };
const storage = JSON.parse(readFileSync(storagePath, "utf8")) as { keys: Array<{ name: string; suffixed: boolean }> };
const file = JSON.parse(readFileSync(outPath, "utf8")) as { schema: string; product: string; surfaces: { browser: { storage: Entry[] } } };

describe("lucida-embed.json", () => {
  it("is exactly what the generator renders from storage.json (run node scripts/gen-embed-manifest.mjs)", () => {
    expect(readFileSync(outPath, "utf8")).toBe(render(storage));
  });

  it("is an embed-v1 manifest for lucida", () => {
    expect(file.schema).toBe("https://cookiemunch.net/schemas/embed-v1.json");
    expect(file.product).toBe("lucida");
  });

  it("lists every storage.json key, suffixed ones as name_*, and the consent keys", () => {
    const names = new Set(file.surfaces.browser.storage.map((e) => e.name));
    for (const k of storage.keys) expect(names.has(k.suffixed ? `${k.name}_*` : k.name)).toBe(true);
    expect(names.has("lc_consent")).toBe(true);
    expect(names.has("lc_distinct_id")).toBe(true);
  });

  it("every entry has a schema-valid type and lifetime", () => {
    for (const e of file.surfaces.browser.storage) {
      expect(["cookie", "localStorage", "sessionStorage"]).toContain(e.type);
      expect(e.lifetime).toMatch(/^(session|persistent|[1-9][0-9]{0,5}(s|m|h|d|w|y))$/);
      expect(e.purpose.en.length).toBeGreaterThan(0);
    }
  });
});

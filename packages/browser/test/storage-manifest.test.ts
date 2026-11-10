import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { keySuffix } from "../src/storage.js";
import { start, tick } from "./helpers.js";

const root = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "storage.json"), "utf8")) as {
  version: string;
  keys: Array<{ name: string; category: string; store: string }>;
  not_storage: { url_parameters: string[]; payload_keys: string[] };
};
const known = new Set([...manifest.keys.map((k) => k.name), ...manifest.not_storage.url_parameters, ...manifest.not_storage.payload_keys]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  localStorage.clear();
  sessionStorage.clear();
  for (const c of document.cookie.split("; ")) if (c) document.cookie = `${c.split("=")[0]}=; Max-Age=0; Path=/`;
});

describe("storage manifest (storage.json)", () => {
  it("matches the package version", () => {
    expect(manifest.version).toBe(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
  });

  it("names every lc_* key the SDK source mentions", () => {
    const unknown = new Set<string>();
    for (const f of sources(join(root, "src"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/["'`](lc_[a-z][a-z0-9_]*)["'`]/g)) if (!known.has(m[1]!) && !/^lc_(pk|sk)_?$/.test(m[1]!)) unknown.add(m[1]!);
    }
    expect([...unknown]).toEqual([]);
  });

  it("lists every key a running client writes, in every persistence mode", async () => {
    const written = new Set<string>();
    const suffix = keySuffix("lc_pk_test");
    const note = (name: string): void => void (name.startsWith("lc_") && written.add(name.endsWith(suffix) ? name.slice(0, -suffix.length) : name));
    for (const persistence of ["cookie", "localStorage", "sessionStorage", "localStorage+cookie"] as const) {
      const { client } = start({ persistence, capturePageview: true, autocapture: false, consent: { mode: "opt_out" } });
      live = client;
      await tick(20);
      client.identify("u1", { plan: "pro" });
      client.group("company", "acme");
      client.register({ a: 1 });
      client.capture("e");
      await client.flush();
      for (let i = 0; i < localStorage.length; i++) note(localStorage.key(i)!);
      for (let i = 0; i < sessionStorage.length; i++) note(sessionStorage.key(i)!);
      for (const c of document.cookie.split("; ")) if (c) note(c.split("=")[0]!);
      await client.shutdown();
      live = undefined;
      localStorage.clear();
      sessionStorage.clear();
      for (const c of document.cookie.split("; ")) if (c) document.cookie = `${c.split("=")[0]}=; Max-Age=0; Path=/`;
    }
    expect(written.size).toBeGreaterThan(3);
    expect([...written].filter((k) => !known.has(k))).toEqual([]);
  });

  it("keeps lc_consent after a decline", async () => {
    const { client } = start({ persistence: "localStorage", capturePageview: false, autocapture: false, consent: { mode: "opt_in" } });
    live = client;
    client.setConsent({ analytics: false, replay: false, marketing: false });
    const left = Object.keys(localStorage).filter((k) => k.startsWith("lc_"));
    expect(left).toEqual([`lc_consent${keySuffix("lc_pk_test")}`]);
  });
});

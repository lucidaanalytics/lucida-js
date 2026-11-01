// Enforces the bundle budget: core entry <= 15 KB gzip (docs/plan/13-dx-sdks.md). Run after `tsup`.
// Other entries and the lazy replay chunk (loader + recorder chunk) are reported; the loader is capped.
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const gz = (f) => gzipSync(readFileSync(new URL(`../dist/${f}`, import.meta.url))).length;
const limits = { "core.js": 15 * 1024, "index.js": 30 * 1024, "replay.js": 8 * 1024, "consent.js": 5 * 1024, "guides.js": 8 * 1024 };
const kb = (n) => (n / 1024).toFixed(2);
let failed = false;
const files = readdirSync(new URL("../dist/", import.meta.url)).filter((f) => f.endsWith(".js"));
for (const f of files.sort()) {
  const size = gz(f);
  const max = limits[f];
  const ok = max === undefined || size <= max;
  console.log(`${ok ? "ok  " : "FAIL"} dist/${f}: ${kb(size)} KB gzip${max ? ` (limit ${max / 1024} KB)` : ""}`);
  if (!ok) failed = true;
}
const lazy = files.filter((f) => f.startsWith("recorder") || f.startsWith("banner") || f.startsWith("persistent") || f.startsWith("chunk-")).reduce((n, f) => n + gz(f), 0);
console.log(`info lazy chunk(s) total (replay recorder, consent banner): ${kb(lazy)} KB gzip (loaded on demand)`);
process.exit(failed ? 1 : 0);

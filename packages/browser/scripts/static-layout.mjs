// Versioned static layout for CDN / self-hosting (docs/guides/sdk-pinning.md):
//   dist/static/v<version>/*.js     immutable; what pinned snippets and lazily loaded `modules` point at
//   dist/static/v<major>/*.js       floating alias for the latest release of a major (never cache-forever)
//   dist/static/v<version>/manifest.json    {version, files: {"lucida.js": "sha384-...", "<name>.js": "sha384-..."}}
// Usage: node scripts/static-layout.mjs [distDir] (default ./dist). Run after tsup.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.argv[2] ?? join(root, "dist");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lib = /LIB_VERSION = "([^"]+)"/.exec(readFileSync(join(root, "src/client.ts"), "utf8"))?.[1];
if (lib !== version) {
  console.error(`LIB_VERSION (${lib}) in src/client.ts must equal package.json version (${version}): lazy modules load from /static/v<LIB_VERSION>/`);
  process.exit(1);
}

const files = readdirSync(dist).filter((f) => f.endsWith(".js"));
// manifest.json: sha384 SRI per file. The loader (src/delivery.ts) checks every lazy module against it before running it;
// the README snippet pins lucida.js with the same hash. Entries are `lucida.js` and `<name>.js` (lazy chunks a
// module imports are not listed: they are only reachable from a verified entry).
const sri = (f) => `sha384-${createHash("sha384").update(readFileSync(join(dist, f))).digest("base64")}`;
const manifestFiles = {};
for (const f of files.sort()) if (!f.startsWith("chunk-")) manifestFiles[f] = sri(f);
const manifest = JSON.stringify({ version, files: manifestFiles }, null, 2) + "\n";
for (const dir of [`v${version}`, `v${version.split(".")[0]}`]) {
  const out = join(dist, "static", dir);
  mkdirSync(out, { recursive: true });
  for (const f of files) copyFileSync(join(dist, f), join(out, f));
  writeFileSync(join(out, "manifest.json"), manifest);
}
console.log(`static layout: ${files.length} files -> static/v${version}/ and static/v${version.split(".")[0]}/`);

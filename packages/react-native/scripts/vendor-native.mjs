// Copies the Lucida iOS and Android SDK sources into ios/vendor and android/vendor (gitignored) before packing.
// In the public mirror (scripts/sdk-mirror/repos.tsv) the same dirs are already in place, so this is a no-op there.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdks = join(pkg, "..");
const pairs = [
  ["ios/Sources/Lucida", "ios/vendor/Lucida"],
  ["android/lucida-core/src/main/kotlin", "android/vendor/lucida-core"],
  ["android/lucida-android/src/main/kotlin", "android/vendor/lucida-android"],
];
for (const [from, to] of pairs) {
  const src = join(sdks, from);
  if (!existsSync(src)) {
    if (existsSync(join(pkg, to))) continue; // mirror layout: already vendored
    throw new Error(`missing ${src} and no ${to}`);
  }
  rmSync(join(pkg, to), { recursive: true, force: true });
  mkdirSync(dirname(join(pkg, to)), { recursive: true });
  cpSync(src, join(pkg, to), { recursive: true });
}

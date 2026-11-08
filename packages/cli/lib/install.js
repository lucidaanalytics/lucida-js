// Finds, downloads, verifies and unpacks the `lucida` binary from the GitHub release this package pins.
// The SHA-256 of every archive ships inside this package, so a download is trusted only if it matches.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import release from "./release.json" with { type: "json" };

const OS = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCH = { x64: "amd64", arm64: "arm64" };
export const RELEASES = "https://github.com/lucidaanalytics/lucida-cli/releases/download";

/** The archive and binary names for a platform, or an error naming what is supported. */
export function target(platform = process.platform, arch = process.arch, version = release.version) {
  const os = OS[platform], a = ARCH[arch];
  if (!os || !a) throw new Error(`no lucida binary for ${platform}/${arch}: builds exist for macOS, Linux and Windows on x64 and arm64`);
  const win = os === "windows";
  return { archive: `lucida_${version}_${os}_${a}.${win ? "zip" : "tar.gz"}`, exe: win ? "lucida.exe" : "lucida" };
}

export function cacheDir(env = process.env, platform = process.platform) {
  if (env.LUCIDA_CACHE_DIR) return env.LUCIDA_CACHE_DIR;
  if (platform === "win32") return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "lucida", "cli");
  if (platform === "darwin") return join(homedir(), "Library", "Caches", "lucida", "cli");
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "lucida", "cli");
}

export function verify(archive, bytes, sums = release.sha256) {
  const want = sums[archive];
  if (!want) throw new Error(`${archive} has no pinned checksum in this package`);
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== want) throw new Error(`${archive}: checksum mismatch (got ${got}, want ${want}); not running it`);
}

/** The named file's bytes from a gzipped tar. */
export function fromTarGz(gz, name) {
  const tar = gunzipSync(gz);
  for (let off = 0; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const path = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    const body = off + 512;
    if (path.replace(/^\.\//, "") === name) return tar.subarray(body, body + size);
    off = body + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${name} not found in the archive`);
}

/** The named file's bytes from a zip (stored or deflated), read through its central directory. */
export function fromZip(zip, name) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip archive");
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28), xlen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.subarray(p + 46, p + 46 + nlen).toString("utf8") === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`unsupported zip compression ${method}`);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error(`${name} not found in the archive`);
}

/** Path to the cached binary, downloading and verifying it on first use. */
export async function ensureBinary({ env = process.env, log = (m) => process.stderr.write(m + "\n") } = {}) {
  const { archive, exe } = target();
  const bin = join(cacheDir(env), release.version, exe);
  if (existsSync(bin)) return bin;
  const url = `${RELEASES}/v${release.version}/${archive}`;
  log(`lucida: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  verify(archive, bytes);
  const out = archive.endsWith(".zip") ? fromZip(bytes, exe) : fromTarGz(bytes, exe);
  mkdirSync(dirname(bin), { recursive: true });
  const tmp = `${bin}.${process.pid}.tmp`; // rename keeps a concurrent first run from seeing half a file
  writeFileSync(tmp, out, { mode: 0o755 });
  chmodSync(tmp, 0o755);
  renameSync(tmp, bin);
  return bin;
}

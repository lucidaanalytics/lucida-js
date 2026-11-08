import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import { fromTarGz, fromZip, target, verify } from "../lib/install.js";

function tar(name, body) {
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
  const pad = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return Buffer.concat([h, body, pad, Buffer.alloc(1024)]);
}

function zip(name, body) {
  const data = deflateRawSync(body), n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = local.length + n.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length + n.length, 12); end.writeUInt32LE(cdOff, 16);
  return Buffer.concat([local, n, data, cd, n, end]);
}

test("names the archive for each platform", () => {
  assert.deepEqual(target("darwin", "arm64", "9.9.9"), { archive: "lucida_9.9.9_darwin_arm64.tar.gz", exe: "lucida" });
  assert.deepEqual(target("win32", "x64", "9.9.9"), { archive: "lucida_9.9.9_windows_amd64.zip", exe: "lucida.exe" });
  assert.throws(() => target("freebsd", "x64"), /no lucida binary for freebsd\/x64/);
});

test("pins a checksum for every published archive", () => {
  for (const [p, a] of [["darwin", "x64"], ["darwin", "arm64"], ["linux", "x64"], ["linux", "arm64"], ["win32", "x64"], ["win32", "arm64"]]) {
    assert.throws(() => verify(target(p, a).archive, Buffer.from("x")), /checksum mismatch/);
  }
  assert.throws(() => verify("other.tar.gz", Buffer.from("x")), /no pinned checksum/);
});

test("unpacks the binary from tar.gz and zip", () => {
  const body = Buffer.from("#!binary\n".repeat(100));
  assert.deepEqual(fromTarGz(gzipSync(Buffer.concat([tar("README", Buffer.from("r")).subarray(0, 1024), tar("lucida", body)])), "lucida"), body);
  assert.deepEqual(fromZip(zip("lucida.exe", body), "lucida.exe"), body);
  assert.throws(() => fromTarGz(gzipSync(tar("other", body)), "lucida"), /not found/);
});

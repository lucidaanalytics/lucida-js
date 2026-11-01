let lastMs = 0;
let seq = 0;

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** UUIDv7 (RFC 9562): 48-bit ms timestamp, 12-bit counter keeps ids monotonic within a ms. */
export function uuidv7(now: number = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    const r2 = randomBytes(2);
    seq = (((r2[0] ?? 0) << 8) | (r2[1] ?? 0)) & 0x3ff;
  } else {
    seq++;
    if (seq > 0xfff) {
      lastMs++;
      seq = 0;
    }
  }
  const r = randomBytes(8);
  const b = new Uint8Array(16);
  const ms = lastMs;
  b[0] = Math.floor(ms / 2 ** 40) & 255;
  b[1] = Math.floor(ms / 2 ** 32) & 255;
  b[2] = Math.floor(ms / 2 ** 24) & 255;
  b[3] = Math.floor(ms / 2 ** 16) & 255;
  b[4] = Math.floor(ms / 2 ** 8) & 255;
  b[5] = ms & 255;
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 255;
  b[8] = 0x80 | ((r[0] ?? 0) & 0x3f);
  for (let i = 1; i < 8; i++) b[8 + i] = r[i] ?? 0;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

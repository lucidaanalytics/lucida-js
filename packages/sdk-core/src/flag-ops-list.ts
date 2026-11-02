/** List and network operators: port of go/internal/flageval/ops_list.go (testdata/flags/vectors_list.json). */

export type FilterOpList = "array_contains_any" | "array_contains_all" | "array_contains_none" | "ip_in_cidr" | "ip_not_in_cidr";

const V4_OCTET = /^(0|[1-9]\d{0,2})$/;
const HEXTET = /^[0-9a-fA-F]{1,4}$/;
const BITS = /^(0|[1-9]\d*)$/;

function parseV4(s: string): number[] | undefined {
  const parts = s.split(".");
  if (parts.length !== 4) return undefined;
  const out: number[] = [];
  for (const p of parts) {
    if (!V4_OCTET.test(p) || Number(p) > 255) return undefined;
    out.push(Number(p));
  }
  return out;
}

function parseV6(s: string): number[] | undefined {
  if (s.includes("%")) return undefined; // zoned addresses are invalid
  let body = s;
  const last = s.lastIndexOf(":");
  const tail = s.slice(last + 1);
  if (tail.includes(".")) {
    // an embedded IPv4 tail counts as two groups
    const v4 = parseV4(tail);
    if (!v4) return undefined;
    body = `${s.slice(0, last + 1)}${(((v4[0] as number) << 8) | (v4[1] as number)).toString(16)}:${(((v4[2] as number) << 8) | (v4[3] as number)).toString(16)}`;
  }
  const halves = body.split("::");
  if (halves.length > 2) return undefined;
  const groups = (h: string): number[] | undefined => {
    if (h === "") return [];
    const out: number[] = [];
    for (const g of h.split(":")) {
      if (!HEXTET.test(g)) return undefined;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = groups(halves[0] as string);
  const rest = halves.length === 2 ? groups(halves[1] as string) : [];
  if (!head || !rest) return undefined;
  const n = head.length + rest.length;
  if (halves.length === 2 ? n > 7 : n !== 8) return undefined; // "::" stands for at least one zero group
  const all = [...head, ...Array<number>(8 - n).fill(0), ...rest];
  return all.flatMap((g) => [g >> 8, g & 0xff]);
}

/** Bytes of an address as written: 4 for IPv4, 16 for IPv6 (no unmapping). */
function rawIP(s: string): number[] | undefined {
  return s.includes(":") ? parseV6(s) : parseV4(s);
}

const isMapped = (b: number[]): boolean => b.length === 16 && b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;

/** Bytes of an IPv4 (4) or IPv6 (16) address; IPv4-mapped IPv6 reads as IPv4 (Go netip Unmap). */
export function parseIP(v: unknown): number[] | undefined {
  if (typeof v !== "string") return undefined;
  const b = rawIP(v.trim());
  return b && isMapped(b) ? b.slice(12) : b;
}

interface Block {
  bytes: number[];
  bits: number;
}

/** A CIDR block, a bare address (one host) or a list of them; invalid entries are skipped. */
function blocks(want: unknown): Block[] {
  const raw = typeof want === "string" ? [want] : Array.isArray(want) ? want : [];
  const out: Block[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const s = r.trim();
    const i = s.indexOf("/");
    if (i < 0) {
      const a = parseIP(s);
      if (a) out.push({ bytes: a, bits: a.length * 8 });
      continue;
    }
    const a = rawIP(s.slice(0, i));
    const bits = s.slice(i + 1);
    if (!a || !BITS.test(bits) || Number(bits) > a.length * 8) continue;
    out.push({ bytes: a, bits: Number(bits) });
  }
  return out;
}

function contains(b: Block, ip: number[]): boolean {
  if (b.bytes.length !== ip.length) return false;
  for (let bit = 0; bit < b.bits; bit += 8) {
    const n = Math.min(8, b.bits - bit);
    const mask = (0xff << (8 - n)) & 0xff;
    const i = bit / 8;
    if (((b.bytes[i] as number) & mask) !== ((ip[i] as number) & mask)) return false;
  }
  return true;
}

/** Applies an array or IP operator to a set property; unknown operators never match. */
export function matchList(op: string, prop: unknown, want: unknown, equal: (a: unknown, b: unknown) => boolean): boolean {
  switch (op) {
    case "array_contains_any":
    case "array_contains_all":
    case "array_contains_none": {
      if (!Array.isArray(prop) || !Array.isArray(want)) return false;
      const hits = want.filter((w) => prop.some((h) => equal(h, w))).length;
      return op === "array_contains_any" ? hits > 0 : op === "array_contains_all" ? hits === want.length : hits === 0;
    }
    case "ip_in_cidr":
    case "ip_not_in_cidr": {
      const ip = parseIP(prop);
      const bs = blocks(want);
      if (!ip || !bs.length) return false;
      return bs.some((b) => contains(b, ip)) === (op === "ip_in_cidr");
    }
  }
  return false;
}

/** Spec v2 operators: port of go/internal/flageval/ops_v2.go (testdata/flags/README.md, "Spec v2"). */

export type FilterOpV2 =
  | "icontains" | "not_icontains" | "starts_with" | "not_starts_with" | "ends_with" | "not_ends_with"
  | "between" | "not_between" | "is_date_before" | "is_date_after"
  | "semver_eq" | "semver_neq" | "semver_gt" | "semver_gte" | "semver_lt" | "semver_lte"
  | "semver_tilde" | "semver_caret" | "semver_wildcard";

export interface V2Helpers {
  toFloat(v: unknown): number | undefined;
  parseVersion(v: unknown): number[] | undefined;
  cmpVersion(a: unknown, b: unknown): number | undefined;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REL = /^-?(\d{1,6})([hdwmy])$/;
const UNIT: Record<string, number> = { h: 3600, d: 86400, w: 7 * 86400, m: 30 * 86400, y: 365 * 86400 };

/** Seconds before now of a relative date (`-7d`, `3h`); fixed unit lengths (m = 30 d, y = 365 d). */
export function relativeSeconds(s: string): number | undefined {
  const m = REL.exec(s.trim());
  return m ? Number(m[1]) * (UNIT[m[2] as string] as number) : undefined;
}

/** Epoch ms of a number (unix seconds), RFC 3339 timestamp or YYYY-MM-DD; values may be relative. */
function instant(v: unknown, nowMs: number, rel: boolean): number | undefined {
  if (typeof v === "number") return v * 1000;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (rel) {
    const secs = relativeSeconds(s);
    if (secs !== undefined) return nowMs - secs * 1000;
  }
  if (!RFC3339.test(s) && !DATE.test(s)) return undefined;
  const t = Date.parse(DATE.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(t) ? undefined : t;
}

function cmpParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Half-open [lo, hi) of a tilde, caret or wildcard value. */
export function semverRange(op: FilterOpV2, want: unknown, h: V2Helpers): [number[], number[]] | undefined {
  if (typeof want !== "string") return undefined;
  const parts = want.trim().replace(/^v/, "").split(".");
  if (op === "semver_wildcard") {
    const last = parts[parts.length - 1];
    if (last !== "*" && last !== "x" && last !== "X") return undefined;
    if (parts.length === 1) return [[0], [2 ** 30]];
    const lo = h.parseVersion(parts.slice(0, -1).join("."));
    if (!lo) return undefined;
    const hi = [...lo];
    hi[hi.length - 1] = (hi[hi.length - 1] as number) + 1;
    return [lo, hi];
  }
  const p = h.parseVersion(want);
  if (!p) return undefined;
  while (p.length < 3) p.push(0);
  const [a, b, c] = p as [number, number, number];
  let hi: number[];
  if (op === "semver_tilde" && parts.length === 1) hi = [a + 1, 0, 0];
  else if (op === "semver_tilde" || (a === 0 && b > 0)) hi = [a, b + 1, 0];
  else if (a > 0) hi = [a + 1, 0, 0];
  else hi = [0, 0, c + 1];
  return [p, hi];
}

/** Applies a spec v2 operator to a set property; unknown operators never match. */
export function matchV2(op: string, prop: unknown, want: unknown, nowMs: number, h: V2Helpers): boolean {
  switch (op) {
    case "icontains": case "not_icontains": case "starts_with": case "not_starts_with": case "ends_with": case "not_ends_with": {
      if (typeof prop !== "string" || typeof want !== "string") return false;
      if (op.endsWith("icontains")) return prop.toLowerCase().includes(want.toLowerCase()) === (op === "icontains");
      if (op.endsWith("starts_with")) return prop.startsWith(want) === (op === "starts_with");
      return prop.endsWith(want) === (op === "ends_with");
    }
    case "between": case "not_between": {
      const x = h.toFloat(prop);
      if (!Array.isArray(want) || want.length !== 2 || x === undefined) return false;
      const [lo, hi] = want as unknown[];
      if (typeof lo !== "number" || typeof hi !== "number") return false;
      return (x >= lo && x <= hi) === (op === "between");
    }
    case "is_date_before": case "is_date_after": {
      const p = instant(prop, nowMs, false);
      const w = instant(want, nowMs, true);
      if (p === undefined || w === undefined) return false;
      return op === "is_date_before" ? p < w : p > w;
    }
    case "semver_eq": case "semver_neq": case "semver_gt": case "semver_gte": case "semver_lt": case "semver_lte": {
      const c = h.cmpVersion(prop, want);
      if (c === undefined) return false;
      const t = op.slice(7);
      return t === "eq" ? c === 0 : t === "neq" ? c !== 0 : t === "gt" ? c > 0 : t === "gte" ? c >= 0 : t === "lt" ? c < 0 : c <= 0;
    }
    case "semver_tilde": case "semver_caret": case "semver_wildcard": {
      const v = h.parseVersion(prop);
      const r = semverRange(op, want, h);
      return !!v && !!r && cmpParts(v, r[0]) >= 0 && cmpParts(v, r[1]) < 0;
    }
  }
  return false;
}

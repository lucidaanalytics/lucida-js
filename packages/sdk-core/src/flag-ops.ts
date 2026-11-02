/** Operator semantics: port of go/internal/flageval/ops.go (the reference). */
import { matchList, type FilterOpList } from "./flag-ops-list.js";
import { matchV2, type FilterOpV2 } from "./flag-ops-v2.js";

export type FilterOp =
  | "eq" | "neq" | "contains" | "ncontains" | "regex" | "nregex"
  | "gt" | "gte" | "lt" | "lte" | "is_set" | "is_not_set" | "in" | "not_in"
  | FilterOpV2
  | FilterOpList;

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function toFloat(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && NUM.test(v.trim())) return Number(v.trim());
  return undefined;
}

/** Two numbers compare numerically; a number never equals a string. */
function equal(a: unknown, b: unknown): boolean {
  const na = typeof a === "number";
  const nb = typeof b === "number";
  if (na || nb) return na && nb && a === b;
  return a === b;
}

function parseVersion(v: unknown): number[] | undefined {
  if (typeof v !== "string") return undefined;
  let s = v.trim().replace(/^v/, "");
  const i = s.search(/[-+]/);
  if (i >= 0) s = s.slice(0, i);
  const out: number[] = [];
  for (const p of s.split(".")) {
    if (!/^[+-]?\d+$/.test(p)) return undefined;
    const n = parseInt(p, 10);
    if (n < 0) return undefined;
    out.push(n);
  }
  return out;
}

function cmpVersion(a: unknown, b: unknown): number | undefined {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return undefined;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const cmp = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

/** Missing/null properties match only is_not_set; every other op (even negations) is false. */
export function matchOp(op: FilterOp, prop: unknown, present: boolean, want: unknown, semver: boolean, nowMs = Date.now()): boolean {
  const set = present && prop !== null && prop !== undefined;
  if (op === "is_set") return set;
  if (op === "is_not_set") return !set;
  if (!set) return false;
  switch (op) {
    case "eq":
    case "neq": {
      let eq: boolean;
      if (semver) {
        const c = cmpVersion(prop, want);
        if (c === undefined) return false;
        eq = c === 0;
      } else eq = equal(prop, want);
      return eq === (op === "eq");
    }
    case "contains":
    case "ncontains":
    case "regex":
    case "nregex": {
      if (typeof prop !== "string" || typeof want !== "string") return false;
      if (op === "contains" || op === "ncontains") return prop.includes(want) === (op === "contains");
      let re: RegExp;
      try {
        re = new RegExp(want);
      } catch {
        return false; // invalid pattern never matches, even for nregex (Go: nil regexp)
      }
      return re.test(prop) === (op === "regex");
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      let c: number | undefined;
      if (semver) c = cmpVersion(prop, want);
      else {
        const a = toFloat(prop);
        const b = toFloat(want);
        c = a === undefined || b === undefined ? undefined : cmp(a, b);
      }
      if (c === undefined) return false;
      return op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
    }
    case "in":
    case "not_in": {
      if (!Array.isArray(want)) return false;
      return want.some((w) => equal(prop, w)) === (op === "in");
    }
  }
  if (op.startsWith("array_") || op.startsWith("ip_")) return matchList(op, prop, want, equal);
  return matchV2(op, prop, want, nowMs, { toFloat, parseVersion, cmpVersion });
}

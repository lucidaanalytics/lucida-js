import { matchOp } from "./flag-ops.js";
import type { FilterOp } from "./flag-ops.js";
import { sha256Hex } from "./sha256.js";
import type { Props } from "./ports.js";

/**
 * Port of go/internal/flageval (reference, decision D13) and testdata/flags/README.md.
 * Field names are the JSON wire format so shared vectors load directly.
 */

export type { FilterOp };

export interface PropertyFilter {
  type: "person" | "group" | "cohort" | "device" | "geo" | "app_version" | "flag" | "context";
  key: string;
  op: FilterOp;
  value?: unknown;
  group_type?: string;
  /** `user | device | org` for `context` filters. */
  context_kind?: string;
}

export interface Variant {
  key: string;
  rollout_pct: number;
  payload?: unknown;
}

export interface Aggregation {
  kind: "person" | "group" | "device" | "context";
  group_type?: string;
  context_kind?: string;
}

export interface ConditionGroup {
  filters?: PropertyFilter[];
  rollout_pct: number;
  variant_override?: string;
  /** Per-condition bucketing unit; the condition is skipped when the unit is absent. */
  aggregation?: Aggregation;
}

export interface FlagDefinition {
  key: string;
  type: "boolean" | "multivariate" | "json";
  active: boolean;
  kill_switch?: boolean;
  salt: string;
  variants?: Variant[];
  conditions: ConditionGroup[];
  aggregation: Aggregation;
  prerequisites?: Array<{ flag: string; value: unknown }>;
  payload?: unknown;
  /** Layer bucket range: bucket = floor(hash("namespace", salt, key) * total) must be in [start, end). */
  namespace?: { salt: string; start: number; end: number; total: number };
  /** Units with hash("holdout", salt, key) * 100 < percentage never get the flag. */
  holdout?: { salt: string; percentage: number };
  /** Keep a unit's stored on-assignment (`sticky_assignments`) when allocation changes (see sticky.ts). */
  sticky?: boolean;
  /** Sealed payload of an encrypted remote-config flag; evaluation ignores it. */
  encrypted_payload?: string;
  /** The first condition whose filters match decides; a rollout miss there is `out_of_rollout`. */
  early_exit?: boolean;
  /** Evaluate only for requests declaring one of these app contexts. */
  app_contexts?: string[];
  /** `client | server`; servers filter on it, evaluation ignores it. */
  evaluation_runtime?: string;
}

export interface ContextEntry {
  key?: string | undefined;
  properties?: Props | undefined;
}

export interface EvalContext {
  distinct_id: string;
  bucketing_key?: string;
  groups?: Record<string, string>;
  person_properties?: Props;
  group_properties?: Record<string, Props>;
  device_properties?: Props;
  geo_properties?: Props;
  app_version?: string;
  /** Bucketing unit for device aggregation. */
  device_id?: string;
  /** One context per kind (`user`, `device`, `org`); an explicit entry wins over the single-kind fallbacks. */
  contexts?: Record<string, ContextEntry>;
  /** Stored values of sticky flags: flag key -> true or a variant key. */
  sticky_assignments?: Record<string, FlagValue>;
  /** Cohort membership hook (cohort id -> member); an absent id stays requires_server. */
  cohorts?: Record<string, boolean>;
  /** App contexts the caller declares (see FlagDefinition.app_contexts). */
  app_contexts?: string[];
  /** RFC 3339 clock for relative date values; default the wall clock. */
  now?: string;
}

/**
 * The context of one kind. `user` falls back to the bucketing key / distinct id with the person
 * properties, `device` to `device_id` with the device properties; `org` and unknown kinds have none.
 */
function contextOf(c: EvalContext, kind: string | undefined): ContextEntry | undefined {
  const explicit = kind ? c.contexts?.[kind] : undefined;
  if (explicit) return explicit;
  if (kind === "user") return { key: c.bucketing_key || c.distinct_id, properties: c.person_properties };
  if (kind === "device") return { key: c.device_id, properties: c.device_properties };
  return undefined;
}

const CONTEXT_KINDS = ["user", "device", "org"];

export type FlagValue = string | boolean;

export type EvalReason =
  | "inactive" | "kill_switch" | "prerequisite_failed" | "prerequisite_cycle" | "prerequisite_missing"
  | "condition_match" | "no_condition_match" | "requires_server" | "no_bucketing_key"
  | "holdout" | "namespace_excluded" | "sticky_bucket" | "out_of_rollout" | "app_context_excluded";

export interface EvalResult {
  value: FlagValue;
  variant?: string;
  payload?: unknown;
  reason: EvalReason;
  /** -1 when no condition decided the result. */
  condition_index: number;
}

const SCALE = 16 ** 13;

/** Hash in [0,1): first 13 hex chars of sha256 / 16^13 (52 bits, exact in doubles). */
export function flagHash(flagKey: string, salt: string, bucketingKey: string, variant = false): number {
  const s = variant ? `${flagKey}.${salt}.variant.${bucketingKey}` : `${flagKey}.${salt}.${bucketingKey}`;
  return parseInt(sha256Hex(s).slice(0, 13), 16) / SCALE;
}

const off = (reason: EvalReason, condition_index = -1): EvalResult => ({ value: false, reason, condition_index });

type Resolved = Record<string, EvalResult>;

function valueMatches(got: unknown, want: unknown): boolean {
  if (typeof want === "boolean") return typeof got === "boolean" ? got === want : want; // variant string = "on"
  return got === want;
}

function filterMatches(f: PropertyFilter, c: EvalContext, resolved: Resolved): boolean {
  const parsed = c.now ? Date.parse(c.now) : NaN;
  const now = Number.isNaN(parsed) ? Date.now() : parsed;
  let bag: Props | undefined;
  switch (f.type) {
    case "person": bag = c.person_properties; break;
    case "group": bag = c.group_properties?.[f.group_type ?? ""]; break;
    case "device": bag = c.device_properties; break;
    case "geo": bag = c.geo_properties; break;
    case "context":
      if (!CONTEXT_KINDS.includes(f.context_kind ?? "")) return false; // an unknown kind never matches, not even is_not_set
      bag = contextOf(c, f.context_kind)?.properties;
      break;
    case "app_version": return matchOp(f.op, c.app_version, !!c.app_version, f.value, true, now);
    case "flag": {
      const r = resolved[f.key];
      return !!r && matchOp(f.op, r.value, true, f.value, false, now);
    }
    default: return false;
  }
  return matchOp(f.op, bag?.[f.key], !!bag && Object.hasOwn(bag, f.key), f.value, false, now);
}

function pickVariant(f: FlagDefinition, cond: ConditionGroup, key: string): Variant {
  const vs = f.variants as Variant[];
  if (cond.variant_override) {
    const v = vs.find((x) => x.key === cond.variant_override);
    if (v) return v;
  }
  const h = flagHash(f.key, f.salt, key, true) * 100;
  let cum = 0;
  for (const v of vs) {
    cum += v.rollout_pct;
    if (h < cum) return v;
  }
  return vs[vs.length - 1] as Variant; // totals < 100: last variant takes the remainder
}

/** The hash unit of `f` for `c` (undefined or "" when missing); sticky stores key on it. */
export function bucketingKey(f: FlagDefinition, c: EvalContext): string | undefined {
  return unitKey(f.aggregation, c);
}

function unitKey(agg: Aggregation, c: EvalContext): string | undefined {
  return agg.kind === "group" ? c.groups?.[agg.group_type ?? ""]
    : agg.kind === "device" ? c.device_id
    : agg.kind === "context" ? contextOf(c, agg.context_kind)?.key
    : c.bucketing_key || c.distinct_id;
}

/** A stored value of a sticky flag decides once a condition's filters passed (testdata/flags/README.md). */
function stickyResult(f: FlagDefinition, cond: ConditionGroup, i: number, c: EvalContext): EvalResult | undefined {
  const stored = f.sticky ? c.sticky_assignments?.[f.key] : undefined;
  if (stored === undefined) return undefined;
  const res: EvalResult = { value: true, reason: "sticky_bucket", condition_index: i };
  if (f.type === "multivariate" && f.variants?.length) {
    if (f.variants.some((v) => v.key === cond.variant_override)) return undefined; // the override wins
    const v = f.variants.find((x) => x.key === stored);
    if (!v) return undefined;
    res.value = res.variant = v.key;
    if (v.payload !== undefined) res.payload = v.payload;
    return res;
  }
  if (stored !== true) return undefined;
  if (f.type === "json" && f.payload !== undefined) res.payload = f.payload;
  return res;
}

/** Evaluate one flag; prerequisites and `flag` filters read `resolved` (see evaluateAll). */
/** A flag with app contexts evaluates only for a request declaring one; a request declaring none is not filtered. */
function appContextAllowed(f: FlagDefinition, c: EvalContext): boolean {
  if (!f.app_contexts?.length || !c.app_contexts?.length) return true;
  return f.app_contexts.some((x) => c.app_contexts?.includes(x));
}

export function evaluateFlag(f: FlagDefinition, c: EvalContext, resolved: Resolved = {}): EvalResult {
  if (!appContextAllowed(f, c)) return off("app_context_excluded");
  if (!f.active) return off("inactive");
  if (f.kill_switch) return off("kill_switch");
  let server = false;
  for (const p of f.prerequisites ?? []) {
    const r = resolved[p.flag];
    if (!r) return off("prerequisite_missing");
    // undecidable locally; a definite failure elsewhere still wins (matches go/internal/flageval)
    if (r.reason === "requires_server") server = true;
    else if (r.reason === "prerequisite_cycle" || !valueMatches(r.value, p.value)) return off("prerequisite_failed");
  }
  if (server) return off("requires_server");
  const key = bucketingKey(f, c);
  const perCondition = f.conditions.some((x) => x.aggregation);
  if (!key && (!perCondition || f.holdout || f.namespace)) return off("no_bucketing_key");
  if (f.holdout && flagHash("holdout", f.holdout.salt, key ?? "") * 100 < f.holdout.percentage) return off("holdout");
  if (f.namespace && f.namespace.total > 0) {
    const b = Math.floor(flagHash("namespace", f.namespace.salt, key ?? "") * f.namespace.total);
    if (b < f.namespace.start || b >= f.namespace.end) return off("namespace_excluded");
  }
  let skipped = 0;
  for (const [i, cond] of f.conditions.entries()) {
    const ckey = cond.aggregation ? unitKey(cond.aggregation, c) : key;
    if (!ckey) {
      skipped++;
      continue;
    }
    let cohort = false;
    let ok = true;
    for (const fl of cond.filters ?? []) {
      // a flag filter on a requires_server flag is undecidable locally, like a cohort filter
      const member = fl.type === "cohort" ? c.cohorts?.[fl.key] : undefined;
      if (member !== undefined) {
        if (member === (fl.op === "not_in" || fl.op === "neq")) {
          ok = false;
          break;
        }
      } else if (fl.type === "cohort" || (fl.type === "flag" && resolved[fl.key]?.reason === "requires_server")) cohort = true;
      else if (!filterMatches(fl, c, resolved)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (cohort) return off("requires_server", i);
    const sticky = cond.aggregation ? undefined : stickyResult(f, cond, i, c); // the store keys on the flag-level unit
    if (sticky) return sticky;
    if (flagHash(f.key, f.salt, ckey) * 100 >= cond.rollout_pct) {
      if (f.early_exit) return off("out_of_rollout", i);
      continue;
    }
    const res: EvalResult = { value: true, reason: "condition_match", condition_index: i };
    if (f.type === "multivariate" && f.variants?.length) {
      const v = pickVariant(f, cond, ckey);
      res.value = res.variant = v.key;
      if (v.payload !== undefined) res.payload = v.payload;
    } else if (f.type === "json" && f.payload !== undefined) res.payload = f.payload;
    return res;
  }
  return off(skipped > 0 && skipped === f.conditions.length ? "no_bucketing_key" : "no_condition_match");
}

function deps(f: FlagDefinition): string[] {
  return [
    ...(f.prerequisites ?? []).map((p) => p.flag),
    ...f.conditions.flatMap((c) => (c.filters ?? []).filter((x) => x.type === "flag").map((x) => x.key)),
  ];
}

/** Evaluate all flags, resolving prerequisites depth-first; cycles get prerequisite_cycle. */
export function evaluateAll(flags: FlagDefinition[], c: EvalContext): Resolved {
  const byKey = new Map(flags.map((f) => [f.key, f]));
  const out: Resolved = {};
  const state = new Map<string, 1 | 2>();
  const visit = (key: string): void => {
    const f = byKey.get(key);
    if (!f || state.has(key)) return;
    state.set(key, 1);
    let cyc = false;
    for (const d of deps(f)) {
      visit(d);
      if (state.get(d) === 1 || out[d]?.reason === "prerequisite_cycle") cyc = true;
    }
    out[key] = cyc ? off("prerequisite_cycle") : evaluateFlag(f, c, out);
    state.set(key, 2);
  };
  for (const f of flags) visit(f.key);
  return out;
}

/** True when the flag could not be decided locally (cohort filter): ask the server. */
export const requiresServer = (r: EvalResult): boolean => r.reason === "requires_server";

/** False for results an SDK must leave out of its flag set (the flag is limited to other app contexts). */
export const servable = (r: EvalResult): boolean => r.reason !== "app_context_excluded";

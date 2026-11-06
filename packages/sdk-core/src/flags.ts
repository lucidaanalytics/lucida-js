import { matchOp } from "./flag-ops.js";
import { eventFilters, eventMatches, mergePatch } from "./flag-runtime.js";
import type { RuntimeBranch, RuntimeEvents } from "./flag-runtime.js";
import type { FilterOp } from "./flag-ops.js";
import { sha256Hex } from "./sha256.js";
import type { Props } from "./ports.js";

/**
 * Port of go/internal/flageval (reference, decision D13) and testdata/flags/README.md.
 * Field names are the JSON wire format so shared vectors load directly.
 */

export type { FilterOp };
export type { RuntimeBranch, RuntimeEvents };

export interface PropertyFilter {
  /** `event_property` only inside an event filter's `properties`. */
  type: "person" | "group" | "cohort" | "device" | "geo" | "app_version" | "flag" | "context" | "event" | "event_property";
  key: string;
  op: FilterOp;
  value?: unknown;
  group_type?: string;
  /** `user | device | org` for `context` filters. */
  context_kind?: string;
  /** `session` (default) or `page` for `event` filters: where the event count is taken. */
  scope?: "session" | "page";
  /** `event` filters: predicates on the counted event's own properties; only matching events count (see countKey). */
  properties?: PropertyFilter[];
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
  /** RFC 7386 JSON merge patch applied to the served payload when this condition decides. */
  payload_patch?: unknown;
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
  /** Event counts so far by scope (`session`, `page`); absent = unknown, event conditions come back as `runtime` branches. */
  runtime_events?: RuntimeEvents;
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
  /** Results that hold when a branch's event filters pass on live counts (first wins); see resolveRuntime. */
  runtime?: RuntimeBranch[];
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
    return patched(res, v.payload, cond);
  }
  if (stored !== true) return undefined;
  return patched(res, f.type === "json" ? f.payload : undefined, cond);
}

/** Sets `res.payload` to `payload` with the condition's merge patch applied (P-L10). */
function patched(res: EvalResult, payload: unknown, cond: ConditionGroup): EvalResult {
  const p = cond.payload_patch === undefined || cond.payload_patch === null ? payload : mergePatch(payload, cond.payload_patch);
  if (p !== undefined) res.payload = p;
  return res;
}

const withRuntime = (r: EvalResult, b: RuntimeBranch[]): EvalResult => (b.length ? { ...r, runtime: b } : r);

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
  const branches: RuntimeBranch[] = [];
  for (const [i, cond] of f.conditions.entries()) {
    const ckey = cond.aggregation ? unitKey(cond.aggregation, c) : key;
    if (!ckey) {
      skipped++;
      continue;
    }
    let cohort = false;
    let ok = true;
    let pending = false;
    for (const fl of cond.filters ?? []) {
      if (fl.type === "event") {
        // without counts (a server) the event filters are left to the client as a runtime branch
        if (c.runtime_events === undefined) pending = true;
        else if (!eventMatches(fl, c.runtime_events)) {
          ok = false;
          break;
        }
        continue;
      }
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
    if (cohort) return withRuntime(off("requires_server", i), branches);
    const r = outcome(f, cond, i, c, ckey);
    if (!r) continue;
    if (pending) branches.push({ filters: eventFilters(cond.filters), result: r });
    else return withRuntime(r, branches);
  }
  return withRuntime(off(skipped > 0 && skipped === f.conditions.length ? "no_bucketing_key" : "no_condition_match"), branches);
}

/** What condition i (filters passed) decides; undefined = try the next condition. */
function outcome(f: FlagDefinition, cond: ConditionGroup, i: number, c: EvalContext, ckey: string): EvalResult | undefined {
  const sticky = cond.aggregation ? undefined : stickyResult(f, cond, i, c); // the store keys on the flag-level unit
  if (sticky) return sticky;
  if (flagHash(f.key, f.salt, ckey) * 100 >= cond.rollout_pct) return f.early_exit ? off("out_of_rollout", i) : undefined;
  const res: EvalResult = { value: true, reason: "condition_match", condition_index: i };
  if (f.type === "multivariate" && f.variants?.length) {
    const v = pickVariant(f, cond, ckey);
    res.value = res.variant = v.key;
    return patched(res, v.payload, cond);
  }
  return patched(res, f.type === "json" ? f.payload : undefined, cond);
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
    out[key] = cyc ? off("prerequisite_cycle") : evaluateDependent(f, c, out);
    state.set(key, 2);
  };
  for (const f of flags) visit(f.key);
  return out;
}

/**
 * evaluateFlag for evaluateAll (go/internal/flageval runtime_deps.go). When a flag `f` reads has still runtime
 * branches (a server without the client's counts), `f` is also evaluated for every other value that flag can take,
 * prepended as branches on `{type: "flag", key, op: "eq", value}`, so the client re-resolves `f` after the flip.
 * Only dependencies the evaluation actually read are branched on, found per branch, so there is no cap and cost
 * follows the distinct outcomes reached.
 */
function evaluateDependent(f: FlagDefinition, c: EvalContext, resolved: Resolved): EvalResult {
  return evalOver(f, c, resolved, [], new Set());
}

/** Branch on `pending`, then on any further runtime-branched dependency the leaf evaluation read; `done` = already branched on this path. */
function evalOver(f: FlagDefinition, c: EvalContext, resolved: Resolved, pending: string[], done: Set<string>): EvalResult {
  const [dep, ...rest] = pending;
  if (dep === undefined) {
    const reads = new Set<string>();
    const tracked = new Proxy(resolved, { get: (t, k) => (reads.add(String(k)), t[k as string]) });
    const r = evaluateFlag(f, c, tracked);
    const more: string[] = [];
    for (const d of deps(f)) if (reads.has(d) && !done.has(d) && !more.includes(d) && resolved[d]?.runtime?.length) more.push(d);
    return more.length ? evalOver(f, c, resolved, more, new Set([...done, ...more])) : r;
  }
  const base = evalOver(f, c, resolved, rest, done);
  const cur = resolved[dep] as EvalResult;
  const tried = new Set<FlagValue>([cur.value]);
  const branches: RuntimeBranch[] = [];
  for (const alt of outcomes(cur)) {
    if (tried.has(alt.value)) continue;
    tried.add(alt.value);
    const r = evalOver(f, c, { ...resolved, [dep]: alt }, rest, done);
    if (same(r, base)) continue; // the flip does not change f
    branches.push({ filters: [{ type: "flag", key: dep, op: "eq", value: alt.value }], result: r });
  }
  const all = [...branches, ...(base.runtime ?? [])];
  const { runtime: _old, ...plain } = base;
  return all.length ? { ...plain, runtime: all } : plain;
}

/** The results `r`'s branches can resolve to, depth first in branch order, without their own branches. */
function outcomes(r: EvalResult): EvalResult[] {
  return (r.runtime ?? []).flatMap((b) => {
    const { runtime: _nested, ...x } = b.result;
    return [x, ...outcomes(b.result)];
  });
}

/** Deep equality of JSON-shaped values; an undefined member equals a missing one (Go DeepEqual on zero fields). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!same(ra[k], rb[k])) return false;
  return true;
}

/** True when the flag could not be decided locally (cohort filter): ask the server. */
export const requiresServer = (r: EvalResult): boolean => r.reason === "requires_server";

/** False for results an SDK must leave out of its flag set (the flag is limited to other app contexts). */
export const servable = (r: EvalResult): boolean => r.reason !== "app_context_excluded";

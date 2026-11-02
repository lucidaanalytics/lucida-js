import { matchOp } from "./flag-ops.js";
import type { EvalResult, FlagDefinition, PropertyFilter } from "./flags.js";
import type { Props } from "./ports.js";

/**
 * Runtime-event targeting (P-H6, testdata/flags/README.md "Runtime events"): `event` filters count
 * events done in this session or page view. A server cannot see those counts, so it returns every
 * condition decided except for its event filters as a `runtime` branch; the client resolves them.
 */

/** Event counts by scope (`session`, `page`) and event name (or countKey). */
export type RuntimeEvents = Partial<Record<"session" | "page", Record<string, number>>>;

/** A condition decided except for its event filters (or, for a dependent flag, a dependency's value). */
export interface RuntimeBranch {
  filters: PropertyFilter[];
  result: EvalResult;
}

/**
 * The runtime count an event filter reads: the event name, or with property predicates
 * `name|[[key,op,value],...]` (same as go/internal/flageval CountKey).
 */
export function countKey(f: PropertyFilter): string {
  if (!f.properties?.length) return f.key;
  return `${f.key}|${JSON.stringify(f.properties.map((p) => [p.key, p.op, p.value ?? null]))}`;
}

/** An event with `props` satisfies every property predicate of `f` (person-property operator semantics). */
export function eventPropsMatch(f: PropertyFilter, props: Props, nowMs = Date.now()): boolean {
  return (f.properties ?? []).every((p) => matchOp(p.op, props[p.key], Object.hasOwn(props, p.key), p.value, false, nowMs));
}

/** is_set = done at least once, is_not_set = never, other operators compare the count (of matching events). */
export function eventMatches(f: PropertyFilter, counts: RuntimeEvents): boolean {
  const n = counts[f.scope ?? "session"]?.[countKey(f)] ?? 0;
  if (f.op === "is_set") return n > 0;
  if (f.op === "is_not_set") return n === 0;
  return matchOp(f.op, n, true, f.value, false);
}

export const eventFilters = (filters: PropertyFilter[] | undefined): PropertyFilter[] => (filters ?? []).filter((f) => f.type === "event");

type Lookup = (key: string) => EvalResult | undefined;

function resolveWith(r: EvalResult, counts: RuntimeEvents, get: Lookup): EvalResult {
  for (const b of r.runtime ?? []) {
    const pass = b.filters.every((f) => {
      if (f.type !== "flag") return eventMatches(f, counts);
      const d = get(f.key);
      return !!d && matchOp(f.op, d.value, true, f.value, false);
    });
    if (pass) return resolveWith(b.result, counts, get);
  }
  if (!r.runtime) return r;
  const { runtime: _branches, ...rest } = r;
  return rest;
}

/**
 * The first branch whose filters all pass on `counts` decides (recursively), else `r` itself without branches.
 * Branches on another flag's value never pass here: resolve a whole response with resolveRuntimeAll.
 */
export function resolveRuntime(r: EvalResult, counts: RuntimeEvents): EvalResult {
  return resolveWith(r, counts, () => undefined);
}

/** Resolves a whole server response, dependencies first, so a flag that reads a flipped flag follows it. */
export function resolveRuntimeAll(results: Record<string, EvalResult>, counts: RuntimeEvents): Record<string, EvalResult> {
  const out: Record<string, EvalResult> = {};
  const state = new Map<string, 1 | 2>();
  const get: Lookup = (key) => {
    if (state.get(key) === 2) return out[key];
    const r = results[key];
    if (!r || state.get(key) === 1) return undefined; // unknown, or a cycle: the branch does not pass
    state.set(key, 1);
    const res = resolveWith(r, counts, get);
    out[key] = res;
    state.set(key, 2);
    return res;
  };
  for (const k of Object.keys(results)) get(k);
  return out;
}

/** Event filters with property predicates in `defs` and in the branches of `results`: the counts a client keeps. */
export function countedFilters(defs: FlagDefinition[] | undefined, results: Record<string, EvalResult>): PropertyFilter[] {
  const out: PropertyFilter[] = [];
  const add = (f: PropertyFilter): void => {
    if (f.type === "event" && f.properties?.length) out.push(f);
  };
  for (const d of defs ?? []) for (const c of d.conditions) for (const f of c.filters ?? []) add(f);
  const walk = (r: EvalResult): void => {
    for (const b of r.runtime ?? []) {
      b.filters.forEach(add);
      walk(b.result);
    }
  };
  Object.values(results).forEach(walk);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** RFC 7386 JSON merge patch, never mutating `target`: objects merge key by key (null deletes), anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isObj(patch)) return patch;
  const out: Record<string, unknown> = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

/**
 * Counts captured events for runtime targeting: per session (reset when the session id changes) and
 * per page view (reset by each `$pageview`, which then counts on the new page).
 */
export class RuntimeCounter {
  private session: Record<string, number> = {};
  private page: Record<string, number> = {};
  private sid = "";

  constructor(saved?: { sid: string; session: Record<string, number> }) {
    if (saved && typeof saved.sid === "string" && isObj(saved.session)) {
      this.sid = saved.sid;
      for (const [k, v] of Object.entries(saved.session)) if (typeof v === "number" && v > 0) this.session[k] = v;
    }
  }

  /**
   * Records one event done in session `sessionId`. `filters` are the event filters with property predicates
   * (countedFilters): each one `props` satisfies also counts under its countKey, once per distinct key.
   */
  record(event: string, sessionId: string, props: Props = {}, filters: PropertyFilter[] = []): void {
    if (sessionId !== this.sid) {
      this.sid = sessionId;
      this.session = {};
      this.page = {};
    }
    if (event === "$pageview") this.page = {};
    const keys = new Set([event]);
    for (const f of filters) if (f.type === "event" && f.key === event && f.properties?.length && eventPropsMatch(f, props)) keys.add(countKey(f));
    for (const k of keys) {
      this.session[k] = (this.session[k] ?? 0) + 1;
      this.page[k] = (this.page[k] ?? 0) + 1;
    }
  }

  counts(sessionId: string): RuntimeEvents {
    return sessionId === this.sid ? { session: { ...this.session }, page: { ...this.page } } : { session: {}, page: {} };
  }

  /** The persisted form (session counts only: page counts end with the page). */
  saved(): { sid: string; session: Record<string, number> } {
    return { sid: this.sid, session: { ...this.session } };
  }
}

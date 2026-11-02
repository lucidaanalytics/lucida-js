import { RuntimeCounter, countedFilters, resolveRuntimeAll } from "@lucida-analytics/sdk-core";
import type { EvalReason, EvalResult, FlagDefinition, Props, PropertyFilter, RuntimeEvents } from "@lucida-analytics/sdk-core";
import type { FlagValue, Host } from "../types.js";

/** Shape of go/gateway POST /v1/flags: per-flag objects; payload is per flag. */
export interface FlagOut {
  enabled?: boolean;
  variant?: string;
  value?: FlagValue;
  payload?: unknown;
  reason?: string;
  condition_index?: number;
  /** Runtime-event branches (P-H6): the first whose event filters pass on this browser's counts wins. */
  runtime?: Array<{ filters: PropertyFilter[]; result: FlagOut }>;
}

export function norm(v: FlagOut | FlagValue): FlagValue {
  return typeof v === "object" ? (v.value ?? v.variant ?? !!v.enabled) : v;
}

export function toEvalResult(x: FlagOut): EvalResult {
  const r: EvalResult = { value: norm(x), reason: (x.reason ?? "remote") as EvalReason, condition_index: x.condition_index ?? -1 };
  if (x.variant) r.variant = x.variant;
  if (x.payload !== undefined) r.payload = x.payload;
  if (x.runtime?.length) r.runtime = x.runtime.map((b) => ({ filters: b.filters, result: toEvalResult(b.result) }));
  return r;
}

const RT_KEY = "lc_rt_events";

export const hasEventFilters = (defs: FlagDefinition[] | undefined): boolean =>
  !!defs?.some((d) => d.conditions.some((c) => c.filters?.some((f) => f.type === "event")));

/**
 * Runtime-event targeting state (P-H6): counts of the events captured in this session and page view,
 * and the server results that still carry event branches. Session counts are written to the
 * consent-gated flag storage only while some flag targets runtime events. Event filters with property
 * predicates (in `localFlags` or server branches) also count the events whose properties match them.
 */
export function runtimeTargeting(host: Host, localFlags?: FlagDefinition[]) {
  let saved: ConstructorParameters<typeof RuntimeCounter>[0];
  try {
    const raw = host.flagStorage.get(RT_KEY);
    if (raw) saved = JSON.parse(raw) as typeof saved;
  } catch {
    /* ignore a corrupt store */
  }
  const counter = new RuntimeCounter(saved);
  let server: Record<string, EvalResult> = {};
  let filters = countedFilters(localFlags, server);
  return {
    counts: (): RuntimeEvents => counter.counts(host.core.sessionId),
    /** Server results of the last response that carry branches (replaces the previous set). */
    setServer(m: Record<string, EvalResult>): void {
      server = m;
      filters = countedFilters(localFlags, server);
    },
    server: (): Record<string, EvalResult> => server,
    drop(keys: string[]): void {
      for (const k of keys) delete server[k];
    },
    /**
     * Each server result with branches, resolved on the current counts, dependencies first: a flag whose
     * prerequisite or flag filter reads a flipped flag follows it.
     */
    resolved(): Record<string, EvalResult> {
      return resolveRuntimeAll(server, counter.counts(host.core.sessionId));
    },
    /** Count one captured event (with its properties); persists the session counts when `persist`. */
    record(event: string, props: Props, persist: boolean): void {
      counter.record(event, host.core.sessionId, props, filters);
      if (persist) host.whenConsented(() => host.flagStorage.set(RT_KEY, JSON.stringify(counter.saved())));
    },
  };
}

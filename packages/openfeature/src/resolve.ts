/**
 * Structural copies of the OpenFeature (Apache-2.0) provider types, so these providers plug into
 * `@openfeature/server-sdk` / `@openfeature/web-sdk` without a dependency on either.
 */
export type ErrorCode = "FLAG_NOT_FOUND" | "TYPE_MISMATCH" | "TARGETING_KEY_MISSING" | "GENERAL";

export type FlagMetadata = Record<string, string | number | boolean>;

export interface ResolutionDetails<T> {
  value: T;
  variant?: string;
  reason?: string;
  errorCode?: ErrorCode;
  errorMessage?: string;
  flagMetadata?: FlagMetadata;
}

export type EvaluationContext = { targetingKey?: string } & Record<string, unknown>;

/** What a Lucida client says about one flag (the `getFeatureFlagDetails` shape; every field but value is optional). */
export interface LucidaDetails {
  value: unknown;
  payload?: unknown;
  variant?: string;
  /** Raw Lucida reason ("condition_match", ..., "fallback"). */
  reason?: string;
  conditionIndex?: number;
  requestId?: string;
  evaluatedLocally?: boolean;
}

/** Mirrors testdata/openfeature/reasons.json (the tests compare them). */
export const REASONS: Record<string, string> = {
  condition_match: "TARGETING_MATCH",
  sticky_bucket: "CACHED",
  no_condition_match: "DEFAULT",
  out_of_rollout: "DEFAULT",
  holdout: "DEFAULT",
  namespace_excluded: "DEFAULT",
  no_bucketing_key: "DEFAULT",
  prerequisite_failed: "DEFAULT",
  prerequisite_missing: "DEFAULT",
  prerequisite_cycle: "ERROR",
  inactive: "DISABLED",
  kill_switch: "DISABLED",
  app_context_excluded: "DISABLED",
  preview: "STATIC",
  user_preview: "STATIC",
  fallback: "DEFAULT",
};

/** Lucida reason -> OpenFeature reason; a variant string under condition_match is SPLIT, unknown is UNKNOWN. */
export function mapReason(raw: string | undefined, value: unknown): string {
  const r = raw === undefined ? undefined : REASONS[raw];
  if (r === undefined) return "UNKNOWN";
  return raw === "condition_match" && typeof value === "string" ? "SPLIT" : r;
}

const fail = <T>(value: T, errorCode: ErrorCode, errorMessage: string): ResolutionDetails<T> => ({
  value,
  reason: "ERROR",
  errorCode,
  errorMessage,
});

/** lucidaReason, conditionIndex (>= 0), requestId, evaluatedLocally. */
export function flagMetadata(d: LucidaDetails): FlagMetadata {
  return {
    lucidaReason: d.reason ?? "",
    ...(d.conditionIndex !== undefined && d.conditionIndex >= 0 ? { conditionIndex: d.conditionIndex } : {}),
    ...(d.requestId ? { requestId: d.requestId } : {}),
    evaluatedLocally: d.evaluatedLocally ?? false,
  };
}

const native = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);

export interface SplitContext {
  personProperties: Record<string, unknown>;
  groups?: Record<string, string>;
  groupProperties?: Record<string, Record<string, unknown>>;
}

/** targetingKey is the distinct id (read it yourself); `groups` / `groupProperties` map to Lucida groups, the rest to person properties. */
export function splitContext(ctx: EvaluationContext): SplitContext {
  const { targetingKey: _t, groups, groupProperties, ...rest } = ctx;
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
  return {
    personProperties: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, native(v)])),
    ...(isObj(groups) ? { groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, String(v)])) } : {}),
    ...(isObj(groupProperties)
      ? { groupProperties: Object.fromEntries(Object.entries(groupProperties).filter(([, v]) => isObj(v)) as Array<[string, Record<string, unknown>]>) }
      : {}),
  };
}

/** Context attributes other than the targeting key and the group attributes become person properties. */
export const personProperties = (ctx: EvaluationContext): Record<string, unknown> => splitContext(ctx).personProperties;

export type Kind = "boolean" | "string" | "number" | "object";

/** Map one Lucida flag read to OpenFeature details of the requested type. A fallback keeps its value with reason DEFAULT and no error. */
export function toDetails<T>(kind: Kind, def: T, d: LucidaDetails | undefined): ResolutionDetails<T> {
  if (d === undefined || d.value === undefined) return fail(def, "FLAG_NOT_FOUND", "flag not found");
  const variant = d.variant ?? (typeof d.value === "string" ? d.value : undefined);
  const ok = (v: unknown): ResolutionDetails<T> => ({
    value: v as T,
    reason: mapReason(d.reason, d.value),
    flagMetadata: flagMetadata(d),
    ...(variant ? { variant } : {}),
  });
  const body = d.reason === "fallback" ? d.value : d.payload; // a fallback has no payload; its value stands in
  switch (kind) {
    case "boolean":
      // a multivariate flag is on for any variant, like isFeatureEnabled
      return typeof d.value === "boolean" ? ok(d.value) : typeof d.value === "string" ? ok(true) : fail(def, "TYPE_MISMATCH", "flag is not boolean");
    case "string":
      return typeof d.value === "string" ? ok(d.value) : fail(def, "TYPE_MISMATCH", "flag has no string variant");
    case "number":
      return typeof body === "number" ? ok(body) : fail(def, "TYPE_MISMATCH", "flag payload is not a number");
    default:
      return body !== null && typeof body === "object" ? ok(body) : fail(def, "TYPE_MISMATCH", "flag payload is not an object");
  }
}

export { fail };

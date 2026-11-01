/**
 * Structural copies of the OpenFeature (Apache-2.0) provider types, so these providers plug into
 * `@openfeature/server-sdk` / `@openfeature/web-sdk` without a dependency on either.
 */
export type ErrorCode = "FLAG_NOT_FOUND" | "TYPE_MISMATCH" | "TARGETING_KEY_MISSING" | "GENERAL";

export interface ResolutionDetails<T> {
  value: T;
  variant?: string;
  reason?: string;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export type EvaluationContext = { targetingKey?: string } & Record<string, unknown>;

type Flag = boolean | string | undefined;

const fail = <T>(value: T, errorCode: ErrorCode, errorMessage: string): ResolutionDetails<T> => ({
  value,
  reason: "ERROR",
  errorCode,
  errorMessage,
});

/** Context attributes other than the targeting key become person properties. */
export function personProperties(ctx: EvaluationContext): Record<string, unknown> {
  const { targetingKey: _t, ...rest } = ctx;
  return rest;
}

/** Map one Lucida flag read (value + payload) to OpenFeature details of the requested type. */
export function toDetails<T>(
  kind: "boolean" | "string" | "number" | "object",
  def: T,
  value: Flag,
  payload: unknown,
): ResolutionDetails<T> {
  if (value === undefined) return fail(def, "FLAG_NOT_FOUND", "flag not found");
  const variant = typeof value === "string" ? value : undefined;
  const ok = (v: unknown): ResolutionDetails<T> => ({
    value: v as T,
    reason: "TARGETING_MATCH",
    ...(variant ? { variant } : {}),
  });
  switch (kind) {
    case "boolean":
      return ok(value !== false); // a multivariate flag is on for any variant, like isFeatureEnabled
    case "string":
      return typeof value === "string" ? ok(value) : fail(def, "TYPE_MISMATCH", "flag has no string variant");
    case "number":
      return typeof payload === "number" ? ok(payload) : fail(def, "TYPE_MISMATCH", "flag payload is not a number");
    default:
      return payload !== null && typeof payload === "object" ? ok(payload) : fail(def, "TYPE_MISMATCH", "flag payload is not an object");
  }
}

export { fail };

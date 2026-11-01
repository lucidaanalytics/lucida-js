import type { FlagValue } from "./flags.js";

/**
 * One flag as a client SDK knows it: the value plus where it came from. `reason` is the evaluator's reason for a
 * flag decided on the device (`condition_match`, `no_condition_match`...), the server's for a remote one (else
 * `remote`), or the source: `override`, `preview`, `bootstrap`, `cached`, `pushed` (`updateFlags`), `not_found`.
 */
export interface FlagResult {
  key: string;
  /** `false`, `true` or a variant key; undefined when the flag is unknown. */
  value: FlagValue | undefined;
  /** The flag is known and not false. */
  enabled: boolean;
  /** The variant key of a multivariate flag. */
  variant?: string;
  payload?: unknown;
  reason: string;
}

export function flagResult(key: string, value: FlagValue | undefined, payload: unknown, reason: string): FlagResult {
  return {
    key,
    value,
    enabled: value !== undefined && value !== false,
    ...(typeof value === "string" ? { variant: value } : {}),
    ...(payload !== undefined ? { payload } : {}),
    reason: value === undefined ? "not_found" : reason,
  };
}

/** The cached flags response is stored with its time and the distinct id it was fetched for. */
export interface FlagCacheStamp {
  at: number;
  id: string;
}

/**
 * Request cache TTL (`flagOptions.cacheTtlMs`): a non-forced reload is skipped while the last successful response is
 * younger than the TTL and was fetched for the same distinct id. Forced reloads (`reloadFlags()`, identity or property
 * changes) always fetch. TTL 0/unset keeps every reload a request.
 */
export class FlagFreshness {
  private stamp: FlagCacheStamp | undefined;

  constructor(
    private readonly ttlMs: number | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a successful fetch for `id`. */
  mark(id: string): FlagCacheStamp {
    return (this.stamp = { at: this.now(), id });
  }

  /** Adopts the stamp stored next to a cached response. */
  restore(s: Partial<FlagCacheStamp> | undefined): void {
    if (typeof s?.at === "number" && typeof s.id === "string") this.stamp = { at: s.at, id: s.id };
  }

  fresh(id: string): boolean {
    return !!this.ttlMs && this.ttlMs > 0 && !!this.stamp && this.stamp.id === id && this.now() - this.stamp.at < this.ttlMs;
  }

  /** Forget the stamp (inputs changed, so the cached response no longer answers). */
  clear(): void {
    this.stamp = undefined;
  }
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Returns [0,1); injectable for tests. */
  random?: () => number;
}

/** Exponential backoff with jitter: delay is 50%..100% of the capped exponential. */
export function backoffDelay(attempt: number, o: BackoffOptions = {}): number {
  const cap = Math.min(o.maxMs ?? 30_000, (o.baseMs ?? 1000) * 2 ** attempt);
  return Math.round(cap * (0.5 + 0.5 * (o.random ?? Math.random)()));
}

/** Statuses worth retrying: network failure, timeout, rate limit, server errors. */
export function isRetryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

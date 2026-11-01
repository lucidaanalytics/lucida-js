export interface RateLimitConfig {
  /** Sustained events per second (default 10). */
  eventsPerSecond?: number;
  /** Bucket size: the burst allowed before throttling (default 100). */
  burst?: number;
}

/** Token bucket: returns true while a token is available (and takes it). `now` is injectable for tests. */
export function rateLimiter(c: RateLimitConfig, now: () => number = Date.now): () => boolean {
  const rate = c.eventsPerSecond ?? 10;
  const burst = c.burst ?? 100;
  let tokens = burst;
  let last = now();
  return () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

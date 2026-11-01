import { FlagStream } from "./flag-stream.js";
import type { FlagStreamOptions } from "./flag-stream.js";

export interface FlagSyncOptions {
  /** Origin of the API (no trailing slash); the stream is `${apiHost}/v1/flags/stream`. */
  apiHost: string;
  /** Public key: the stream carries only change notices, never flag values. */
  apiKey: string;
  fetch: typeof fetch;
  /** Refetch evaluated flags for the current distinct id. */
  reload: () => void;
  /** Platform visibility: the stream is closed and polling stops while hidden. */
  visibility?: { hidden: () => boolean; subscribe: (cb: () => void) => () => void };
  /** Fallback poll interval while the stream is down (default 60s; 0 = no polling). */
  pollMs?: number;
  backoff?: FlagStreamOptions["backoff"];
  log?: (...a: unknown[]) => void;
}

/**
 * Keeps flags fresh: SSE change notice -> reload; while the stream is down, poll; hidden -> neither.
 * Returns a stop function. Becoming visible again reconnects and reloads once to catch up.
 */
export function startFlagSync(o: FlagSyncOptions): () => void {
  let connected = false;
  let last: string | undefined;
  const stream = new FlagStream({
    url: `${o.apiHost}/v1/flags/stream`,
    secretKey: o.apiKey,
    fetch: o.fetch,
    ...(o.backoff ? { backoff: o.backoff } : {}),
    ...(o.log ? { log: o.log } : {}),
    onState: (c) => (connected = c),
    onChange: (etag) => {
      if (etag !== undefined && etag === last) return;
      last = etag;
      o.reload();
    },
  });
  const hidden = (): boolean => o.visibility?.hidden() ?? false;
  const poll = o.pollMs ?? 60_000;
  const timer = poll > 0 ? setInterval(() => !connected && !hidden() && o.reload(), poll) : undefined;
  const sync = (): void => {
    if (hidden()) stream.stop();
    else {
      stream.start();
      o.reload();
    }
  };
  if (!hidden()) stream.start();
  const unsub = o.visibility?.subscribe(sync);
  return () => {
    stream.stop();
    unsub?.();
    if (timer) clearInterval(timer);
  };
}

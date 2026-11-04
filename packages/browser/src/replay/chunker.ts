import { backoffDelay, isRetryable } from "@lucida-analytics/sdk-core";
import type { BackoffOptions } from "@lucida-analytics/sdk-core";
import { MAX_CHUNK_BYTES } from "./config.js";
import { gzipAsync, gzipBytes } from "./gzip.js";

export interface ChunkerOptions {
  /** POST /v1/replay URL (without query). */
  url: string;
  apiKey: string;
  fetch: typeof fetch;
  ids: () => { sessionId: string; windowId: string };
  chunkBytes: number;
  flushMs: number;
  /** Hold everything back (min_duration_ms) until release(). */
  hold?: boolean;
  /** Called after the gateway accepted a chunk (session id, uncompressed bytes). */
  onSent?: (sessionId: string, bytes: number) => void;
  /** Called when the session id changed since the last chunk (caller takes a fresh full snapshot). */
  onSessionChange?: () => void;
  /** Called when a chunk was given up on (rejected or retries spent): the stream has a hole, so the caller takes a fresh full snapshot. */
  onGap?: () => void;
  maxRetries?: number;
  backoff?: BackoffOptions;
  log?: (...a: unknown[]) => void;
}

interface Chunk {
  json: string;
  /** The serialized events, kept so an oversized pagehide beacon can be split. */
  parts: string[];
  window: string;
  session: string;
  seq: number;
  tries: number;
}

const MAX_PENDING_BYTES = 8_000_000;
const BEACON_LIMIT = 60_000;

/**
 * Collects serialized rrweb events into chunks (flush at chunkBytes or every flushMs), numbers
 * them (`seq` monotonic per window, reset when the session rotates), gzips and POSTs them in
 * order with retry/backoff, and beacons what is left on pagehide.
 */
export function createChunker(o: ChunkerOptions) {
  let parts: string[] = [];
  let bytes = 0;
  let seq = 0;
  let lastSession: string | undefined;
  let held = !!o.hold;
  let dead = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pumping: Promise<void> | undefined;
  const pending: Chunk[] = [];

  const pendingBytes = (): number => pending.reduce((n, c) => n + c.json.length, 0);

  const seal = (): void => {
    if (!parts.length) return;
    const { sessionId, windowId } = o.ids();
    if (lastSession && lastSession !== sessionId) {
      seq = 0;
      o.onSessionChange?.();
    }
    lastSession = sessionId;
    pending.push({ json: render(sessionId, windowId, seq, parts), parts, window: windowId, session: sessionId, seq: seq++, tries: 0 });
    parts = [];
    bytes = 0;
  };

  const render = (sessionId: string, windowId: string, n: number, events: string[]): string =>
    `{"api_key":${JSON.stringify(o.apiKey)},"session_id":${JSON.stringify(sessionId)},` +
    `"window_id":${JSON.stringify(windowId)},"seq":${n},"events":[${events.join(",")}]}`;

  // Retry-After (whole seconds, capped at 5 min) is a floor under the backoff delay.
  let serverWaitMs = 0;
  const post = async (c: Chunk): Promise<number> => {
    try {
      const z = await gzipAsync(c.json);
      const r = await o.fetch(`${o.url}?compression=gzip`, {
        method: "POST",
        body: z,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "omit",
        keepalive: z.length < BEACON_LIMIT,
      });
      const ra = r.headers?.get?.("Retry-After")?.trim() ?? "";
      serverWaitMs = /^\d+$/.test(ra) ? Math.min(Number(ra), 300) * 1000 : 0;
      return r.status;
    } catch {
      return 0;
    }
  };

  const pump = (): Promise<void> => {
    if (held || dead) return Promise.resolve();
    pumping ??= (async () => {
      while (pending.length && !held && !dead) {
        const c = pending[0] as Chunk;
        const status = await post(c);
        if (status >= 200 && status < 300) {
          pending.shift();
          o.onSent?.(c.session, c.json.length);
        }
        else if (!isRetryable(status) || ++c.tries > (o.maxRetries ?? 5)) {
          o.log?.("replay chunk dropped", c.seq, status);
          pending.shift();
          o.onGap?.();
        } else await new Promise((r) => setTimeout(r, Math.max(serverWaitMs, backoffDelay(c.tries - 1, o.backoff))));
      }
    })().finally(() => {
      pumping = undefined;
    });
    return pumping;
  };

  const arm = (): void => {
    timer ??= setTimeout(() => {
      timer = undefined;
      void flush();
    }, o.flushMs);
  };

  const flush = (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    seal();
    if (held && pendingBytes() > MAX_PENDING_BYTES) held = false; // never grow unbounded
    return pump();
  };

  return {
    /** Add one rrweb event. Events too large for the gateway are dropped. */
    add(event: unknown): void {
      if (dead) return;
      const s = JSON.stringify(event);
      if (s.length > MAX_CHUNK_BYTES - 4096) return o.log?.("replay event too large", s.length);
      if (bytes && bytes + s.length > o.chunkBytes) void flush();
      parts.push(s);
      bytes += s.length + 1;
      if (bytes >= o.chunkBytes) void flush();
      else arm();
    },
    flush,
    /** Pagehide: send everything unsent through sendBeacon. No-op while held (session too short). */
    beacon(): void {
      if (held || dead) return;
      seal();
      let n = pending[0]?.seq ?? 0;
      let sess = pending[0]?.session;
      for (const c of pending.splice(0)) {
        if (c.session !== sess) [sess, n] = [c.session, c.seq];
        // sendBeacon refuses bodies over ~64 KB: split a chunk (pieces renumbered, still in order) until each fits.
        const send = (events: string[]): void => {
          const z = gzipBytes(render(c.session, c.window, n, events));
          if (z.length > BEACON_LIMIT && events.length > 1) {
            send(events.slice(0, events.length >> 1));
            send(events.slice(events.length >> 1));
            return;
          }
          n++;
          navigator.sendBeacon?.(`${o.url}?compression=gzip`, new Blob([z], { type: "text/plain" }));
        };
        send(c.parts);
      }
      seq = Math.max(seq, n);
    },
    /** min_duration_ms reached: start sending. */
    release(): void {
      held = false;
      void flush();
    },
    /** Drop everything (consent revoked, session too short). */
    discard(): void {
      dead = true;
      parts = [];
      pending.length = 0;
      if (timer !== undefined) clearTimeout(timer);
    },
    /** Uncompressed bytes not yet accepted by the gateway (open chunk plus queued chunks). */
    get unsent(): number {
      return bytes + pendingBytes();
    },
    get seq(): number {
      return seq;
    },
    get held(): boolean {
      return held;
    },
  };
}

export type Chunker = ReturnType<typeof createChunker>;

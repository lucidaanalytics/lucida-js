import { backoffDelay, isRetryable } from "./retry.js";
import type { BackoffOptions } from "./retry.js";
import type { Clock, Transport, WireEvent } from "./ports.js";

export interface QueueOptions {
  transport: Transport;
  /** Full batch URL, e.g. https://host/v1/batch. */
  url: string;
  apiKey: string;
  flushAt?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
  maxRetries?: number;
  /** Events per request (1..1000, default 1000), independent of flushAt. */
  maxBatchSize?: number;
  backoff?: BackoffOptions;
  clock?: Clock;
  onDrop?: (events: WireEvent[], reason: string) => void;
  log?: (...a: unknown[]) => void;
}

/** Batching event queue: flush at N events or T ms, retry with backoff, drop-oldest when full. */
export class EventQueue {
  private items: WireEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private inflight: Promise<void> | undefined;
  private closed = false;
  private warned404 = false;
  private readonly flushAt: number;
  private readonly intervalMs: number;
  private readonly maxSize: number;
  private readonly maxRetries: number;
  private readonly batchMax: number;

  constructor(private readonly o: QueueOptions) {
    this.flushAt = o.flushAt ?? 20;
    this.intervalMs = o.flushIntervalMs ?? 5000;
    this.maxSize = o.maxQueueSize ?? 1000;
    this.maxRetries = o.maxRetries ?? 5;
    this.batchMax = Math.max(1, Math.min(o.maxBatchSize ?? 1000, 1000));
  }

  get size(): number {
    return this.items.length;
  }

  enqueue(e: WireEvent): void {
    if (this.closed) return;
    this.items.push(e);
    if (this.items.length > this.maxSize) {
      this.o.onDrop?.(this.items.splice(0, this.items.length - this.maxSize), "queue_full");
    }
    if (this.items.length >= this.flushAt) void this.flush();
    else this.arm(this.intervalMs);
  }

  private arm(ms: number): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, ms);
  }

  private disarm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Send everything queued. beacon=true is one shot with no retry (page unload). */
  flush(opts: { beacon?: boolean } = {}): Promise<void> {
    this.disarm();
    if (this.inflight) return this.inflight.then(() => (this.items.length ? this.flush(opts) : undefined));
    if (!this.items.length) return Promise.resolve();
    const batch = this.items.splice(0, this.batchMax);
    const sentAt = (this.o.clock ?? Date).now();
    const body = JSON.stringify({ api_key: this.o.apiKey, batch, sent_at: new Date(sentAt).toISOString() });
    this.o.log?.("send batch", batch.length);
    const p = this.o.transport
      .send(this.o.url, body, opts.beacon ? { beacon: true } : {})
      .then(
        (r) => r,
        () => ({ status: 0, retryAfterMs: undefined }),
      )
      .then((r) => this.settle(batch, r.status, !!opts.beacon, r.retryAfterMs))
      .finally(() => {
        this.inflight = undefined;
      });
    this.inflight = p;
    return p;
  }

  private settle(batch: WireEvent[], status: number, beacon: boolean, retryAfterMs?: number): void {
    if (status >= 200 && status < 300) {
      this.attempt = 0;
      if (this.items.length >= this.flushAt) void this.flush();
      else if (this.items.length) this.arm(this.intervalMs);
      return;
    }
    if (!isRetryable(status) || beacon || this.attempt >= this.maxRetries) {
      if (status === 404 && !this.warned404) {
        this.warned404 = true;
        console.warn(
          `[lucida] ${this.o.url} returned 404, so events are being dropped. apiHost is probably wrong: use https://capture.lucidace.com (or your own capture host), not the app host.`,
        );
      }
      this.o.onDrop?.(batch, `status_${status}`);
      this.attempt = 0;
      return;
    }
    this.items.unshift(...batch);
    const delay = Math.max(backoffDelay(this.attempt++, this.o.backoff), Math.min(retryAfterMs ?? 0, 60_000));
    this.o.log?.("retry in", delay, "ms");
    this.arm(delay);
  }

  /** Discard everything queued (consent revoked). */
  clear(): void {
    this.items = [];
    this.disarm();
  }

  /** Flush once and stop accepting events; pending retries are abandoned. */
  async shutdown(): Promise<void> {
    await this.flush();
    this.closed = true;
    this.disarm();
  }
}

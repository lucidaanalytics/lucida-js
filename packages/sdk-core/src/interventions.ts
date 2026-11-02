import type { Core } from "./core.js";
import { sseParser } from "./flag-stream.js";
import { backoffDelay } from "./retry.js";
import type { BackoffOptions } from "./retry.js";

/** One intervention fired for the current person (N-ANA-2). */
export interface Intervention {
  /** Delivery sequence number (resume cursor). */
  seq: number;
  /** The fire id: stable across redeliveries, dedupe on it. */
  id: string;
  intervention_id: string;
  name: string;
  /** The event that triggered it (`$intervention_test` for a test fire). */
  event: string;
  /** The JSON payload configured on the intervention. */
  payload: unknown;
  fired_at: string;
}

export interface InterventionStreamOptions {
  /** Origin of the gateway (no trailing slash). */
  apiHost: string;
  /** Public key is fine: fires carry the configured payload, never event data. */
  apiKey: string;
  fetch: typeof fetch;
  /** The person fires are for; read on every (re)connect. */
  distinctId: () => string;
  onIntervention: (i: Intervention) => void;
  /** Poll interval when the platform cannot read a streaming body (React Native), default 15s. */
  pollMs?: number;
  backoff?: BackoffOptions;
  log?: (...a: unknown[]) => void;
}

/**
 * Subscribes to GET /v1/interventions/stream (SSE) for the current distinct id and hands each fire to
 * `onIntervention` once. Reconnects with backoff and resumes after the last fire seen; where the fetch
 * response has no readable body it polls GET /v1/interventions instead. `restart()` after an identity
 * change starts over for the new person. A 404 (feature off on this gateway) stops it.
 */
export class InterventionStream {
  private ctl: AbortController | undefined;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cursor = 0;
  private gen = 0;
  /** Set once a response came back without a readable body: poll from then on. */
  private polling = false;

  constructor(private readonly o: InterventionStreamOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop(++this.gen);
  }

  stop(): void {
    this.stopped = true;
    this.gen++;
    this.ctl?.abort();
    if (this.timer) clearTimeout(this.timer);
  }

  /** New person: forget the cursor and reconnect. */
  restart(): void {
    const was = !this.stopped;
    this.stop();
    this.cursor = 0;
    if (was) this.start();
  }

  private live(gen: number): boolean {
    return !this.stopped && gen === this.gen;
  }

  private deliver(i: Intervention): void {
    if (!(i.seq > this.cursor)) return;
    this.cursor = i.seq;
    try {
      this.o.onIntervention(i);
    } catch (e) {
      this.o.log?.("onIntervention threw", e);
    }
  }

  private url(path: string): string {
    const q = `distinct_id=${encodeURIComponent(this.o.distinctId())}${this.cursor ? `&cursor=${this.cursor}` : ""}`;
    return `${this.o.apiHost}${path}?${q}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((r) => {
      this.timer = setTimeout(r, ms);
      (this.timer as { unref?: () => void }).unref?.();
    });
  }

  private async loop(gen: number): Promise<void> {
    let attempt = 0;
    while (this.live(gen)) {
      let wait: number;
      try {
        const r = await this.connectOnce(gen);
        if (r === "gone") return this.stop();
        if (r === "poll") {
          attempt = 0;
          wait = this.o.pollMs ?? 15_000;
        } else {
          if (r === "streamed") attempt = 0;
          wait = backoffDelay(attempt++, this.o.backoff);
        }
      } catch (e) {
        if (this.live(gen)) this.o.log?.("intervention stream error", e);
        wait = backoffDelay(attempt++, this.o.backoff);
      }
      if (!this.live(gen)) return;
      await this.sleep(wait);
    }
  }

  /** "streamed" after a stream ended, "poll" after a poll answer, "gone" on 404, "failed" otherwise. */
  private async connectOnce(gen: number): Promise<"streamed" | "poll" | "gone" | "failed"> {
    if (this.polling) return this.pollOnce(gen);
    this.ctl = new AbortController();
    const headers = { Authorization: `Bearer ${this.o.apiKey}`, Accept: "text/event-stream" };
    const r = await this.o.fetch(this.url("/v1/interventions/stream"), { headers, signal: this.ctl.signal });
    if (r.status === 404) return "gone";
    if (!r.ok) return "failed";
    const body = r.body as ReadableStream<Uint8Array> | null | undefined;
    if (!body || typeof TextDecoderStream === "undefined") {
      this.ctl.abort();
      this.polling = true;
      return this.pollOnce(gen);
    }
    const parse = sseParser((m) => {
      if (m.event !== "intervention" || !this.live(gen)) return;
      try {
        this.deliver(JSON.parse(m.data) as Intervention);
      } catch {
        this.o.log?.("bad intervention payload");
      }
    });
    const reader = body.pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return "streamed";
      parse(value);
    }
  }

  private async pollOnce(gen: number): Promise<"poll" | "gone" | "failed"> {
    this.ctl = new AbortController();
    const r = await this.o.fetch(this.url("/v1/interventions"), { headers: { Authorization: `Bearer ${this.o.apiKey}` }, signal: this.ctl.signal });
    if (r.status === 404) return "gone";
    if (!r.ok) return "failed";
    const page = (await r.json()) as { data?: Intervention[] };
    if (this.live(gen)) for (const i of page.data ?? []) this.deliver(i);
    return "poll";
  }
}

export interface InterventionHub {
  /** Add a listener; the stream opens with the first one (after analytics consent). Returns unsubscribe. */
  on(cb: (i: Intervention) => void): () => void;
  stop(): void;
}

/**
 * The client-side `onIntervention` API shared by the browser and React Native SDKs: one stream for the
 * current person, opened lazily on the first listener once analytics consent is given, restarted on
 * identify/reset and closed while consent is denied.
 */
export function interventionHub(
  core: Core,
  o: Omit<InterventionStreamOptions, "distinctId" | "onIntervention"> & { whenConsented: (fn: () => void) => void; disabled?: boolean },
): InterventionHub {
  const listeners = new Set<(i: Intervention) => void>();
  const { whenConsented, disabled, ...opts } = o;
  const stream = new InterventionStream({
    ...opts,
    distinctId: () => core.distinctId,
    onIntervention: (i) => {
      for (const cb of [...listeners]) cb(i);
    },
  });
  let wanted = false;
  core.onChange((c) => {
    if (!wanted) return;
    if (c === "identify" || c === "reset") stream.restart();
    if (c === "consent") {
      if (core.hasConsent("analytics")) stream.start();
      else stream.stop();
    }
  });
  return {
    on(cb) {
      listeners.add(cb);
      if (!wanted && !disabled) {
        wanted = true;
        whenConsented(() => stream.start());
      }
      return () => void listeners.delete(cb);
    },
    stop: () => stream.stop(),
  };
}

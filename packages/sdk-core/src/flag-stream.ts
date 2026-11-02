import { backoffDelay } from "./retry.js";
import type { BackoffOptions } from "./retry.js";

export interface SseMessage {
  event: string;
  data: string;
  /** The `id:` field, when the server sent one (resume point for Last-Event-ID). */
  id?: string;
}

/** Incremental SSE parser: feed text chunks, get complete messages (comments/keepalives are dropped). */
export function sseParser(onMessage: (m: SseMessage) => void): (chunk: string) => void {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    for (;;) {
      const m = /\r?\n\r?\n/.exec(buf);
      if (!m) return;
      const block = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      let event = "message";
      let id: string | undefined;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(":")) continue;
        const i = line.indexOf(":");
        const [k, v] = i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 1).replace(/^ /, "")];
        if (k === "event") event = v ?? "";
        else if (k === "data") data.push(v ?? "");
        else if (k === "id") id = v;
      }
      if (data.length) onMessage(id === undefined ? { event, data: data.join("\n") } : { event, data: data.join("\n"), id });
    }
  };
}

export interface FlagStreamOptions {
  url: string;
  secretKey: string;
  fetch: typeof fetch;
  /** Called with the new ETag on connect and on every definitions change. */
  onChange: (etag: string | undefined) => void;
  /** True while the stream is connected: callers skip interval polling. */
  onState?: (connected: boolean) => void;
  /** Reconnects wait backoffDelay(attempt); attempts reset after a successful connect. */
  backoff?: BackoffOptions;
  log?: (...a: unknown[]) => void;
}

/**
 * Consumes GET /v1/flags/stream (SSE `definitions` events) with reconnect and exponential backoff.
 * While disconnected `onState(false)` tells the owner to fall back to polling.
 * Any key kind works (`secretKey` is just the Bearer token; a public key is fine in browsers and React Native): the event
 * carries only an ETag, so on change clients refetch POST /v1/flags for their distinct id.
 */
export class FlagStream {
  private ctl: AbortController | undefined;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly o: FlagStreamOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.ctl?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.o.onState?.(false);
  }

  private async loop(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      try {
        if (await this.connectOnce()) attempt = 0;
      } catch (e) {
        if (!this.stopped) this.o.log?.("flag stream error", e);
      }
      this.o.onState?.(false);
      if (this.stopped) return;
      const wait = backoffDelay(attempt++, this.o.backoff);
      await new Promise<void>((r) => {
        this.timer = setTimeout(r, wait);
        (this.timer as { unref?: () => void }).unref?.();
      });
    }
  }

  /** Returns true when the stream was established (so backoff resets). */
  private async connectOnce(): Promise<boolean> {
    this.ctl = new AbortController();
    const r = await this.o.fetch(this.o.url, {
      headers: { Authorization: `Bearer ${this.o.secretKey}`, Accept: "text/event-stream" },
      signal: this.ctl.signal,
    });
    if (!r.ok || !r.body) throw new Error(`stream status ${r.status}`);
    this.o.onState?.(true);
    const parse = sseParser((m) => {
      if (m.event !== "definitions") return;
      try {
        this.o.onChange((JSON.parse(m.data) as { etag?: string }).etag);
      } catch {
        this.o.onChange(undefined);
      }
    });
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return true;
      parse(value);
    }
  }
}

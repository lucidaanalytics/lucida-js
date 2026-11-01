import { FlagStream } from "@lucida/sdk-core";
import type { BackoffOptions, FlagDefinition } from "@lucida/sdk-core";
import { adoptCached, publishCached } from "./defcache.js";
import type { FlagDefinitionCacheProvider } from "./defcache.js";

/** Expected body of GET /v1/flags/definitions (see README). */
export interface DefinitionsResponse {
  flags: FlagDefinition[];
}

/** Polls flag definitions with a secret key, using ETag / If-None-Match. */
export class DefinitionsPoller {
  defs: FlagDefinition[] | undefined;
  private etag: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stream: FlagStream | undefined;
  private streaming = false;

  constructor(
    private readonly o: {
      url: string;
      secretKey: string;
      fetch: typeof fetch;
      timeoutMs: number;
      intervalMs: number;
      log: (...a: unknown[]) => void;
      /** GET /v1/flags/stream URL: reload on server push; interval polling resumes whenever the stream is down. */
      streamUrl?: string;
      streamBackoff?: BackoffOptions;
      cache?: FlagDefinitionCacheProvider;
    },
  ) {}

  start(): Promise<void> {
    this.timer = setInterval(() => {
      if (!this.streaming) void this.load();
    }, this.o.intervalMs);
    this.timer.unref();
    if (this.o.streamUrl) {
      this.stream = new FlagStream({
        url: this.o.streamUrl,
        secretKey: this.o.secretKey,
        fetch: this.o.fetch,
        onChange: () => void this.load(),
        onState: (c) => (this.streaming = c),
        log: this.o.log,
        ...(this.o.streamBackoff ? { backoff: this.o.streamBackoff } : {}),
      });
      this.stream.start();
    }
    return this.load();
  }

  stop(): void {
    this.stream?.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Fetch once; keeps the previous definitions on any failure. */
  async load(): Promise<void> {
    const cached = await adoptCached(this.o.cache);
    if (cached) {
      this.defs = cached;
      return;
    }
    try {
      const r = await this.o.fetch(this.o.url, {
        headers: { Authorization: `Bearer ${this.o.secretKey}`, ...(this.etag ? { "If-None-Match": this.etag } : {}) },
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
      if (r.status === 304) return;
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = (await r.json()) as DefinitionsResponse;
      if (!Array.isArray(j.flags)) throw new Error("bad definitions body");
      this.defs = j.flags;
      this.etag = r.headers.get("etag") ?? undefined;
      await publishCached(this.o.cache, j.flags);
    } catch (e) {
      this.o.log("flag definitions poll failed", e);
    }
  }
}

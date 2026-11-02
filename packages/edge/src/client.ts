import { FlagSnapshot, evaluateAll, requiresServer, servable, uuidv7, withFlagProps } from "@lucida-analytics/sdk-core";
import type { EvalContext, FlagDefinition, FlagValue, Props } from "@lucida-analytics/sdk-core";

export interface EdgeOptions {
  /** Public project key (lc_pk_...): capture and remote flag evaluation. */
  apiKey: string;
  /** Secret key (lc_sk_...): enables local evaluation from cached definitions. Never ship it to browsers. */
  secretKey?: string;
  host?: string;
  /** Definitions cache lifetime per isolate. Default 30 s. */
  ttlMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** `ctx.waitUntil` (Workers, Vercel Edge) so captures finish after the response. Without it captures are awaited by `flush()`. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** App contexts this worker declares; flags limited to other contexts are not served. */
  appContexts?: string[];
}

export interface EdgeFlagOptions {
  personProperties?: Props;
  groups?: Record<string, string>;
  groupProperties?: Record<string, Props>;
  deviceProperties?: Props;
  geoProperties?: Props;
  appVersion?: string;
  appContexts?: string[];
  /** Id the person had before identify; remote evaluation keeps continuity flags in that bucket (LC-FLG-34). */
  anonDistinctId?: string;
}

/** capture() extras: attach a snapshot's flags, or evaluate the visitor's flags first. */
export interface EdgeCaptureOptions {
  flags?: FlagSnapshot;
  sendFeatureFlags?: boolean | EdgeFlagOptions;
  /** Fixed event id, so a retried caller (a re-run Convex action, a queue redelivery) dedupes at the gateway. */
  uuid?: string;
  /** ISO time the event happened (default now). */
  timestamp?: string;
}

interface Remote {
  enabled?: boolean;
  variant?: string;
  value?: FlagValue;
  payload?: unknown;
}

const ctxOf = (id: string, o: EdgeFlagOptions): EvalContext => ({
  distinct_id: id,
  ...(o.groups ? { groups: o.groups } : {}),
  ...(o.personProperties ? { person_properties: o.personProperties } : {}),
  ...(o.groupProperties ? { group_properties: o.groupProperties } : {}),
  ...(o.deviceProperties ? { device_properties: o.deviceProperties } : {}),
  ...(o.geoProperties ? { geo_properties: o.geoProperties } : {}),
  ...(o.appVersion ? { app_version: o.appVersion } : {}),
  ...(o.appContexts?.length ? { app_contexts: o.appContexts } : {}),
});

/**
 * Fetch-only Lucida client for edge runtimes (Cloudflare Workers, Vercel Edge, Deno, Fastly Compute).
 * No timers, no Node APIs: definitions are fetched lazily and cached for `ttlMs`, flags evaluate locally with
 * the shared evaluator and fall back to POST /v1/flags only for what cannot be decided locally (cohorts).
 */
export class EdgeClient {
  private readonly host: string;
  private readonly doFetch: typeof fetch;
  private defs: FlagDefinition[] | undefined;
  private etag: string | undefined;
  private fetchedAt = 0;
  private inflight: Promise<void> | undefined;
  private pending: Promise<unknown>[] = [];

  constructor(private readonly o: EdgeOptions) {
    this.host = (o.host ?? "https://app.lucida.dev").replace(/\/+$/, "");
    this.doFetch = o.fetch ?? ((...a) => fetch(...a));
  }

  private signal = (): AbortSignal => AbortSignal.timeout(this.o.timeoutMs ?? 3000);

  /** Refresh when stale (concurrent callers share one request); keeps the old definitions on failure. */
  private refresh(): Promise<void> {
    if (!this.o.secretKey || (this.defs && Date.now() - this.fetchedAt < (this.o.ttlMs ?? 30_000))) return Promise.resolve();
    this.inflight ??= (async () => {
      try {
        const r = await this.doFetch(`${this.host}/v1/flags/definitions`, {
          headers: { Authorization: `Bearer ${this.o.secretKey}`, ...(this.etag ? { "If-None-Match": this.etag } : {}) },
          signal: this.signal(),
        });
        if (r.status === 304) this.fetchedAt = Date.now();
        else if (r.ok) {
          const j = (await r.json()) as { flags?: FlagDefinition[] };
          if (Array.isArray(j.flags)) {
            this.defs = j.flags;
            this.etag = r.headers.get("etag") ?? undefined;
            this.fetchedAt = Date.now();
          }
        }
      } catch {
        // stale definitions (or remote fallback) keep serving
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  private async remote(id: string, o: EdgeFlagOptions): Promise<Record<string, { value: FlagValue; payload?: unknown }>> {
    try {
      const r = await this.doFetch(`${this.host}/v1/flags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: this.signal(),
        body: JSON.stringify({
          api_key: this.o.apiKey,
          distinct_id: id,
          ...(o.anonDistinctId ? { anon_distinct_id: o.anonDistinctId } : {}),
          groups: o.groups ?? {},
          person_properties: o.personProperties ?? {},
          group_properties: o.groupProperties ?? {},
          ...(o.appContexts?.length ? { app_contexts: o.appContexts } : {}),
        }),
      });
      if (!r.ok) return {};
      const j = (await r.json()) as { flags?: Record<string, Remote> };
      return Object.fromEntries(
        Object.entries(j.flags ?? {}).map(([k, f]) => [k, { value: f.value ?? f.variant ?? !!f.enabled, payload: f.payload }]),
      );
    } catch {
      return {};
    }
  }

  /** Every flag's value and payload for one visitor. Failures yield `{}` (never throws). */
  async evaluate(distinctId: string, o: EdgeFlagOptions = {}): Promise<Record<string, { value: FlagValue; payload?: unknown }>> {
    if (!o.appContexts && this.o.appContexts) o = { ...o, appContexts: this.o.appContexts };
    await this.refresh();
    const out: Record<string, { value: FlagValue; payload?: unknown }> = {};
    let needRemote = !this.defs;
    for (const [k, r] of Object.entries(this.defs ? evaluateAll(this.defs, ctxOf(distinctId, o)) : {})) {
      if (requiresServer(r)) needRemote = true;
      else if (servable(r)) out[k] = { value: r.value, payload: r.payload };
    }
    return needRemote ? { ...(await this.remote(distinctId, o)), ...out } : out;
  }

  async getAllFlags(distinctId: string, o?: EdgeFlagOptions): Promise<Record<string, FlagValue>> {
    return Object.fromEntries(Object.entries(await this.evaluate(distinctId, o)).map(([k, v]) => [k, v.value]));
  }

  async getFlag(key: string, distinctId: string, o?: EdgeFlagOptions): Promise<FlagValue | undefined> {
    return (await this.evaluate(distinctId, o))[key]?.value;
  }

  async isFeatureEnabled(key: string, distinctId: string, o?: EdgeFlagOptions): Promise<boolean> {
    const v = await this.getFlag(key, distinctId, o);
    return v !== undefined && v !== false;
  }

  async getFlagPayload(key: string, distinctId: string, o?: EdgeFlagOptions): Promise<unknown> {
    return (await this.evaluate(distinctId, o))[key]?.payload;
  }

  /** Evaluate once; read the snapshot freely and pass it to `capture(..., {flags})`. */
  async evaluateFlags(distinctId: string, o?: EdgeFlagOptions): Promise<FlagSnapshot> {
    const all = await this.evaluate(distinctId, o);
    const pick = <T>(f: (v: { value: FlagValue; payload?: unknown }) => T) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, f(v)]));
    return new FlagSnapshot(pick((v) => v.value), Object.fromEntries(Object.entries(pick((v) => v.payload)).filter(([, p]) => p !== undefined)));
  }

  /**
   * Send one event (at-least-once: the gateway dedupes on the generated uuid). Handed to `waitUntil` when given.
   * `flags` attaches a snapshot's `$feature/*` values; `sendFeatureFlags` evaluates them first.
   */
  capture(distinctId: string, event: string, properties: Props = {}, opts: EdgeCaptureOptions = {}): void {
    const at = opts.timestamp ?? new Date().toISOString();
    const props: Promise<Props> = opts.flags
      ? Promise.resolve(withFlagProps(properties, opts.flags.values as Record<string, FlagValue>))
      : opts.sendFeatureFlags
        ? this.getAllFlags(distinctId, typeof opts.sendFeatureFlags === "object" ? opts.sendFeatureFlags : {}).then((v) => withFlagProps(properties, v))
        : Promise.resolve(properties);
    const p = props.then((pr) => this.send(distinctId, event, pr, at, opts.uuid ?? uuidv7())).catch(() => undefined);
    if (this.o.waitUntil) this.o.waitUntil(p);
    else this.pending.push(p);
  }

  private send(distinctId: string, event: string, properties: Props, at: string, uuid: string): Promise<unknown> {
    return this.doFetch(`${this.host}/v1/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: this.signal(),
      body: JSON.stringify({
        api_key: this.o.apiKey,
        sent_at: new Date().toISOString(),
        batch: [{ uuid, event, distinct_id: distinctId, timestamp: at, properties: { ...properties, $lib: "lucida-edge" } }],
      }),
    });
  }

  /** Await captures not handed to `waitUntil`. */
  async flush(): Promise<void> {
    await Promise.all(this.pending.splice(0));
  }
}

export const createEdgeClient = (o: EdgeOptions): EdgeClient => new EdgeClient(o);

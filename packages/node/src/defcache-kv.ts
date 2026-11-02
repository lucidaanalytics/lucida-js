import type { FlagDefinition } from "@lucida-analytics/sdk-core";
import type { FlagDefinitionCacheProvider } from "./defcache.js";

type Maybe<T> = T | Promise<T>;

/** The two operations the cache needs; adapt any store (Redis, Cloudflare KV, DynamoDB...) to it. */
export interface KvClient {
  get(key: string): Maybe<string | null | undefined>;
  /** Stores `value` for `ttlSeconds`. With `ifAbsent`, resolves true only when this call created the key (a lock). */
  set(key: string, value: string, ttlSeconds: number, ifAbsent?: boolean): Maybe<boolean>;
}

/** The slice of an ioredis or node-redis client the adapter touches (no dependency on either package). */
export interface RedisLike {
  get(key: string): Maybe<string | null | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(...args: any[]): Maybe<unknown>;
}

/** Wrap a user-supplied Redis client. `ioredis`: `set(k, v, "EX", s, "NX")`; `node-redis`: `set(k, v, { EX, NX })`. */
export function redisKv(client: RedisLike, style: "ioredis" | "node-redis" = "ioredis"): KvClient {
  return {
    get: (k) => client.get(k),
    set: async (k, v, ttl, ifAbsent) => {
      const r =
        style === "ioredis"
          ? await client.set(k, v, "EX", ttl, ...(ifAbsent ? ["NX"] : []))
          : await client.set(k, v, { EX: ttl, ...(ifAbsent ? { NX: true } : {}) });
      return r === "OK";
    },
  };
}

export interface KvCacheOptions {
  /** Key prefix, default `lucida:flags`. */
  prefix?: string;
  /** How long a stored copy stays readable, default 300 s. */
  ttlSeconds?: number;
  /** How long the fetch lock is held, default 30 s: one worker per window calls the server. */
  lockSeconds?: number;
}

/**
 * Optional shared definitions cache over any key-value store: the worker that wins the lock fetches and
 * publishes, the others read the stored copy. A missing or unparsable copy reads as "nothing cached".
 */
export class KvFlagDefinitionCache implements FlagDefinitionCacheProvider {
  private readonly prefix: string;
  private readonly ttl: number;
  private readonly lock: number;

  constructor(
    private readonly kv: KvClient,
    o: KvCacheOptions = {},
  ) {
    this.prefix = o.prefix ?? "lucida:flags";
    this.ttl = o.ttlSeconds ?? 300;
    this.lock = o.lockSeconds ?? 30;
  }

  async getFlagDefinitions(): Promise<FlagDefinition[] | undefined> {
    const raw = await this.kv.get(`${this.prefix}:defs`);
    if (!raw) return undefined;
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? (v as FlagDefinition[]) : undefined;
    } catch {
      return undefined;
    }
  }

  async shouldFetchFlagDefinitions(): Promise<boolean> {
    return this.kv.set(`${this.prefix}:lock`, "1", this.lock, true);
  }

  async onFlagDefinitionsReceived(definitions: FlagDefinition[]): Promise<void> {
    await this.kv.set(`${this.prefix}:defs`, JSON.stringify(definitions), this.ttl);
  }
}

/** Convenience: a Redis-backed provider from a user-supplied client. */
export function redisFlagDefinitionCache(client: RedisLike, style: "ioredis" | "node-redis" = "ioredis", o?: KvCacheOptions): KvFlagDefinitionCache {
  return new KvFlagDefinitionCache(redisKv(client, style), o);
}

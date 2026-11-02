import type { FlagDefinition } from "@lucida-analytics/sdk-core";

type Maybe<T> = T | Promise<T>;

/**
 * Share one definitions fetch between workers (Redis, KV...). Before each poll the client asks `shouldFetchFlagDefinitions()`:
 * when false it adopts `getFlagDefinitions()` instead of calling the server (the lock winner fetches and calls
 * `onFlagDefinitionsReceived`). A provider that throws is treated as "fetch yourself". See the README for a Redis sketch.
 */
export interface FlagDefinitionCacheProvider {
  getFlagDefinitions(): Maybe<FlagDefinition[] | undefined>;
  shouldFetchFlagDefinitions(): Maybe<boolean>;
  onFlagDefinitionsReceived(definitions: FlagDefinition[]): Maybe<void>;
  shutdown?(): Maybe<void>;
}

/** Reference implementation: process-local, fetches again once `ttlMs` has passed. */
export class InMemoryFlagDefinitionCache implements FlagDefinitionCacheProvider {
  private defs: FlagDefinition[] | undefined;
  private at = 0;
  constructor(private readonly ttlMs = 30_000) {}

  getFlagDefinitions(): FlagDefinition[] | undefined {
    return this.defs;
  }
  shouldFetchFlagDefinitions(): boolean {
    return !this.defs || Date.now() - this.at >= this.ttlMs;
  }
  onFlagDefinitionsReceived(definitions: FlagDefinition[]): void {
    this.defs = definitions;
    this.at = Date.now();
  }
}

/** Definitions to use instead of fetching, or undefined when this process must fetch. */
export async function adoptCached(p: FlagDefinitionCacheProvider | undefined): Promise<FlagDefinition[] | undefined> {
  if (!p) return undefined;
  try {
    return (await p.shouldFetchFlagDefinitions()) ? undefined : await p.getFlagDefinitions();
  } catch {
    return undefined;
  }
}

export async function publishCached(p: FlagDefinitionCacheProvider | undefined, defs: FlagDefinition[]): Promise<void> {
  try {
    await p?.onFlagDefinitionsReceived(defs);
  } catch {
    /* a failing cache must not break flag evaluation */
  }
}

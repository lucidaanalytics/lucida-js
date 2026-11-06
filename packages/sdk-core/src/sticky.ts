import { bucketingKey, evaluateAll } from "./flags.js";
import type { EvalContext, EvalResult, FlagDefinition, FlagValue } from "./flags.js";

/**
 * Persistent sticky-bucketing store (LC-EXT-29): the value each unit got from a sticky flag, so it
 * keeps it when rollout or variant weights change. Keyed by the flag's bucketing key.
 * Synchronous (fits memory and localStorage); for an async backend use AsyncStickyStore + evaluateAllStickyAsync.
 */
export interface StickyStore {
  get(bucketingKey: string): Record<string, FlagValue> | undefined;
  set(bucketingKey: string, flagKey: string, value: FlagValue): void;
}

/** In-process store (lost on restart); the default for server SDKs. */
export class MemoryStickyStore implements StickyStore {
  private readonly m = new Map<string, Record<string, FlagValue>>();
  get(key: string): Record<string, FlagValue> | undefined {
    return this.m.get(key);
  }
  set(key: string, flag: string, value: FlagValue): void {
    this.m.set(key, { ...this.m.get(key), [flag]: value });
  }
  /** Forget every stored assignment of a flag (re-randomise). */
  clear(flag: string): void {
    for (const v of this.m.values()) delete v[flag];
  }
}

/** What to persist for result `r` of `f`: the on-value of a fresh hash match, else undefined. */
export const stickyValue = (f: FlagDefinition, r: EvalResult): FlagValue | undefined =>
  f.sticky && r.reason === "condition_match" && r.value !== false ? r.value : undefined;

/** evaluateAll with stored assignments loaded from `store` and fresh sticky matches written back. */
export function evaluateAllSticky(flags: FlagDefinition[], c: EvalContext, store: StickyStore): Record<string, EvalResult> {
  const assigned: Record<string, FlagValue> = { ...c.sticky_assignments };
  for (const f of flags) {
    const k = f.sticky ? bucketingKey(f, c) : undefined;
    const v = k ? store.get(k)?.[f.key] : undefined;
    if (v !== undefined) assigned[f.key] = v;
  }
  const out = evaluateAll(flags, { ...c, sticky_assignments: assigned });
  for (const f of flags) {
    const r = out[f.key];
    const v = r && stickyValue(f, r);
    const k = v === undefined ? undefined : bucketingKey(f, c);
    if (k && v !== undefined) store.set(k, f.key, v);
  }
  return out;
}

/** Sticky store whose reads and writes are asynchronous (Redis, a database, React Native storage). */
export interface AsyncStickyStore {
  get(bucketingKey: string): Promise<Record<string, FlagValue> | undefined>;
  set(bucketingKey: string, flagKey: string, value: FlagValue): Promise<void>;
}

/**
 * evaluateAllSticky over an async store: the assignments of every bucketing key the sticky flags use are
 * awaited first (so evaluation sees the stored values), evaluation runs on that snapshot, and the fresh
 * matches are written back (queued, then awaited together). A failed read or write only means re-hashing
 * next time; it never fails the evaluation.
 */
export async function evaluateAllStickyAsync(flags: FlagDefinition[], c: EvalContext, store: AsyncStickyStore): Promise<Record<string, EvalResult>> {
  const keys = new Set<string>();
  for (const f of flags) {
    const k = f.sticky ? bucketingKey(f, c) : undefined;
    if (k) keys.add(k);
  }
  const snapshot = new MemoryStickyStore();
  const writes: Promise<void>[] = [];
  await Promise.all(
    [...keys].map(async (k) => {
      for (const [flag, v] of Object.entries((await store.get(k).catch(() => undefined)) ?? {})) snapshot.set(k, flag, v);
    }),
  );
  const queued: StickyStore = {
    get: (k) => snapshot.get(k),
    set(k, flag, v) {
      if (snapshot.get(k)?.[flag] === v) return; // already stored
      snapshot.set(k, flag, v);
      writes.push(store.set(k, flag, v).catch(() => undefined));
    },
  };
  const out = evaluateAllSticky(flags, c, queued);
  await Promise.all(writes);
  return out;
}

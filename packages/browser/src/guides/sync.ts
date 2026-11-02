import type { Storage } from "@lucida/sdk-core";
import type { Host } from "../types.js";

/** Storage keys that make up a person's guide state (see progress.ts and index.ts). */
export const SEEN_KEY = "lc_guide_seen";
const MAP_KEYS = ["lc_guide_views", "lc_guide_progress", "lc_guide_checked", "lc_guide_dismissed", "lc_guide_holdout", "lc_guide_snoozed"] as const;
export const GUIDE_KEYS: readonly string[] = [SEEN_KEY, ...MAP_KEYS];
const PUSH_DELAY_MS = 2000;

type State = Record<string, unknown>;
type Dict = Record<string, unknown>;
const dict = (v: unknown): Dict => (v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const union = (a: unknown, b: unknown): unknown[] => [...new Set([...list(a), ...list(b)])];

/**
 * Merge a server snapshot into the local one so no device loses progress: seen and checklist items are unions,
 * dismissals and holdout marks keep the latest time, views keep the newest 50, and a tour position stays local when set.
 */
export function mergeGuideState(local: State, remote: State): State {
  const out: State = { [SEEN_KEY]: union(local[SEEN_KEY], remote[SEEN_KEY]) };
  for (const key of MAP_KEYS) {
    const a = dict(local[key]);
    const b = dict(remote[key]);
    const m: Dict = {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "lc_guide_checked") m[id] = union(a[id], b[id]);
      else if (key === "lc_guide_views") m[id] = (union(a[id], b[id]) as number[]).sort((x, y) => x - y).slice(-50);
      else if (key === "lc_guide_progress") m[id] = a[id] ?? b[id];
      else m[id] = Math.max(Number(a[id]) || 0, Number(b[id]) || 0);
    }
    out[key] = m;
  }
  return out;
}

const read = (store: Storage): State =>
  Object.fromEntries(
    GUIDE_KEYS.map((k) => {
      try {
        return [k, JSON.parse(store.get(k) ?? "null")];
      } catch {
        return [k, null];
      }
    }),
  );

/**
 * Server-side guide state (G55): pull merges what the gateway holds for this person into the consent-gated local
 * storage, and every later local change is pushed (debounced). Nothing runs before analytics consent or without a
 * distinct id, and failures are silent: local storage stays the source of truth.
 */
export function guideSync(host: Host, store: Storage) {
  const { core } = host;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let on = false;
  const call = async (state?: State): Promise<State> => {
    const r = await host.fetch(`${host.config.apiHost}/v1/guide-state`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      credentials: "omit",
      body: JSON.stringify({ api_key: host.apiKey, distinct_id: core.distinctId, ...(state ? { state } : {}) }),
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
    return dict(((await r.json()) as { state?: unknown }).state);
  };
  const enabled = (): boolean => host.config.guides?.syncState !== false && !!core.distinctId && core.hasConsent("analytics");
  const push = (): void => {
    timer = undefined;
    if (enabled()) call(read(store)).catch((e) => host.log("guide state push failed", e));
  };
  return {
    /** Merge the server copy into local storage and push the union back. Resolves even when the server fails. */
    async pull(): Promise<void> {
      if (!enabled()) return;
      try {
        const merged = mergeGuideState(read(store), await call());
        for (const [k, v] of Object.entries(merged)) store.set(k, JSON.stringify(v));
        on = true;
        push();
      } catch (e) {
        host.log("guide state pull failed", e);
      }
    },
    /** A guide key changed locally. */
    touch(): void {
      if (on && !timer) timer = setTimeout(push, PUSH_DELAY_MS);
    },
    stop(): void {
      if (timer) clearTimeout(timer);
    },
  };
}

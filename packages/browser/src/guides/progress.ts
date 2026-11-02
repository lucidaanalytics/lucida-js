import type { Storage } from "@lucida/sdk-core";

/** Guide state kept in the consent-gated storage: views, tour position, checklist items and dismissals. */
export function guideState(store: Storage) {
  const read = <T>(key: string, empty: T): T => {
    try {
      return (JSON.parse(store.get(key) ?? "null") as T | null) ?? empty;
    } catch {
      return empty;
    }
  };
  const map = <V>(key: string) => ({
    get: (id: string): V | undefined => read<Record<string, V>>(key, {})[id],
    set(id: string, v: V | undefined): void {
      const m = read<Record<string, V>>(key, {});
      if (v === undefined) delete m[id];
      else m[id] = v;
      store.set(key, JSON.stringify(m));
    },
  });
  return {
    /** Unix ms of each show, per guide id (newest 50). */
    views: map<number[]>("lc_guide_views"),
    /** Step id a tour reached, so it resumes on the next page. */
    tour: map<string>("lc_guide_progress"),
    /** Checklist item ids done. */
    checked: map<string[]>("lc_guide_checked"),
    /** Persistent guides the person closed for good. */
    dismissed: map<number>("lc_guide_dismissed"),
    /** Guides whose holdout exposure was already sent. */
    held: map<number>("lc_guide_holdout"),
    /** Unix ms a snoozed guide may show again after (N-DAP-6). */
    snoozed: map<number>("lc_guide_snoozed"),
  };
}

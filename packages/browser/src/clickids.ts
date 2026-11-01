import type { Storage } from "@lucida/sdk-core";

/** Ad-platform click ids (Google incl. gad_source / gclsrc / DoubleClick dclid, Meta, Instagram igshid, Microsoft, TikTok, LinkedIn, X, Mailchimp mc_cid). */
export const CLICK_IDS = ["gclid", "gad_source", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "igshid", "msclkid", "ttclid", "li_fat_id", "twclid", "mc_cid"] as const;
const KEY = "lc_click_ids";
const DAY = 86_400_000;

type Stored = Record<string, { v: string; t: number }>;

/**
 * Remembers the last-touch click ids from landing URLs for `expiryDays` (default 90). State goes through the
 * consent-gated storage, so nothing is persisted before analytics consent; events are dropped before consent anyway.
 */
export function clickIdTracker(storage: Storage, expiryDays = 90, now: () => number = Date.now) {
  let seen: string | undefined;
  const read = (): Stored => {
    try {
      return JSON.parse(storage.get(KEY) ?? "{}") as Stored;
    } catch {
      return {};
    }
  };
  /** Absorb ids from the current URL (parsed once per distinct query string), return the unexpired ones. */
  return (): Record<string, string> => {
    const stored = read();
    if (location.search !== seen) {
      seen = location.search;
      const q = new URLSearchParams(seen);
      let hit = false;
      for (const k of CLICK_IDS) {
        const v = q.get(k);
        if (v) {
          stored[k] = { v: v.slice(0, 512), t: now() };
          hit = true;
        }
      }
      if (hit) storage.set(KEY, JSON.stringify(stored));
    }
    const out: Record<string, string> = {};
    for (const k of CLICK_IDS) {
      const e = stored[k];
      if (e && now() - e.t < expiryDays * DAY) out[k] = e.v;
    }
    return out;
  };
}

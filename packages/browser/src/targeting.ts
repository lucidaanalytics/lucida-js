import type { PropFilter, TargetConditions } from "./types.js";

export interface EligibleCtx {
  url: string;
  flags: (key: string) => boolean;
  /** The served value of a flag (variant key for multivariate flags). */
  flagValue?: (key: string) => boolean | string | undefined;
  /** Unix ms of the last guide shown to this person, if any. */
  lastShownMs: number | undefined;
  nowMs: number;
  random: () => number;
  /** Person properties (identify `$set`) and group properties by group type. */
  person?: Record<string, unknown>;
  groups?: Record<string, Record<string, unknown>>;
  device?: "desktop" | "mobile" | "tablet";
  /** Whether this browser has shown the guide with that id. */
  seen?: (id: string) => boolean;
  /** Unix ms of each earlier show of THIS guide (frequency caps). */
  views?: number[];
}

type Targeted = { conditions: TargetConditions };

function urlOk(c: TargetConditions, url: string): boolean {
  if (!c.url) return true;
  if (c.url_match === "exact") return url === c.url;
  if (c.url_match === "regex") {
    try {
      return new RegExp(c.url).test(url);
    } catch {
      return false; // a bad pattern never shows the guide
    }
  }
  return url.includes(c.url);
}

/** One property test; a missing property only satisfies `neq`. */
export function propOk(f: PropFilter, props: Record<string, unknown> | undefined): boolean {
  const v = props?.[f.key];
  if (f.op === "exists") return v !== undefined && v !== null;
  if (v === undefined || v === null) return f.op === "neq";
  const [a, b] = [String(v), String(f.value ?? "")];
  return f.op === "eq" ? a === b : f.op === "neq" ? a !== b : a.includes(b);
}

/** Inside the schedule window and its recurrence (weekdays, local hours; `to` 24 = end of day). */
export function scheduleOk(s: NonNullable<TargetConditions["schedule"]>, now: number): boolean {
  if (s.start && now < Date.parse(s.start)) return false;
  if (s.end && now >= Date.parse(s.end)) return false;
  const d = new Date(now);
  if (s.days?.length && !s.days.includes(d.getDay())) return false;
  const h = d.getHours();
  return !s.hours || (h >= (s.hours.from ?? 0) && h < (s.hours.to ?? 24));
}

/** Under the frequency cap given the earlier shows of the guide. */
export function frequencyOk(f: NonNullable<TargetConditions["frequency"]>, views: number[], now: number): boolean {
  const since = f.per_days ? now - f.per_days * 86_400_000 : 0;
  return views.filter((t) => t >= since).length < (f.max_views ?? 1);
}

/** Client-side targeting (guides); event_trigger and delay are handled by the caller (they are about when, not whether). */
export function eligible(s: Targeted, ctx: EligibleCtx): boolean {
  const c = s.conditions;
  if (!urlOk(c, ctx.url)) return false;
  if (c.flag_key && !ctx.flags(c.flag_key)) return false;
  if (c.flag_key && c.flag_variant && String(ctx.flagValue?.(c.flag_key)) !== c.flag_variant) return false;
  if (c.wait_days && ctx.lastShownMs !== undefined && ctx.nowMs - ctx.lastShownMs < c.wait_days * 86_400_000) return false;
  if (c.devices?.length && ctx.device && !c.devices.includes(ctx.device)) return false;
  if (c.person_filters?.some((f) => !propOk(f, ctx.person))) return false;
  if (c.group_filters?.some((f) => !propOk(f, ctx.groups?.[f.group_type ?? ""]))) return false;
  if (c.seen_guides?.some((id) => !ctx.seen?.(id))) return false;
  if (c.not_seen_guides?.some((id) => ctx.seen?.(id))) return false;
  if (c.schedule && !scheduleOk(c.schedule, ctx.nowMs)) return false;
  if (c.frequency && !frequencyOk(c.frequency, ctx.views ?? [], ctx.nowMs)) return false;
  if (c.sample_pct !== undefined && c.sample_pct > 0 && c.sample_pct < 100 && ctx.random() * 100 >= c.sample_pct) return false;
  return true;
}

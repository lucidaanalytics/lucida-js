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

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekday (0 = Sunday) and hour of `now` in an IANA zone; local time when the zone is unknown. */
function zoned(now: number, timeZone: string): { day: number; h: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { day: DAYS.indexOf(get("weekday")), h: Number(get("hour")) % 24 };
  } catch {
    return { day: new Date(now).getDay(), h: new Date(now).getHours() };
  }
}

/** Inside the schedule window and its recurrence (weekdays, local hours; `to` 24 = end of day). */
export function scheduleOk(s: NonNullable<TargetConditions["schedule"]>, now: number): boolean {
  if (s.start && now < Date.parse(s.start)) return false;
  if (s.end && now >= Date.parse(s.end)) return false;
  const { day, h } = s.timezone ? zoned(now, s.timezone) : { day: new Date(now).getDay(), h: new Date(now).getHours() };
  if (s.days?.length && !s.days.includes(day)) return false;
  return !s.hours || (h >= (s.hours.from ?? 0) && h < (s.hours.to ?? 24));
}

/** Under the frequency cap given the earlier shows of the guide. */
export function frequencyOk(f: NonNullable<TargetConditions["frequency"]>, views: number[], now: number): boolean {
  const since = f.per_days ? now - f.per_days * 86_400_000 : 0;
  return views.filter((t) => t >= since).length < (f.max_views ?? 1);
}

/** `*` glob over the whole string (mirrors the gateway's guide exclusion matcher). */
function glob(pattern: string, s: string): boolean {
  const body = pattern
    .split("*")
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + "$").test(s);
}

/** Project-wide exclusion: `href` matches one of the patterns (a pattern starting with `/` is matched against the path). */
export function urlExcluded(href: string, patterns: readonly string[] | undefined): boolean {
  if (!href || !patterns?.length) return false;
  let path = href;
  try {
    path = new URL(href).pathname || href;
  } catch {
    /* not absolute: match the string as given */
  }
  return patterns.some((p) => typeof p === "string" && p !== "" && glob(p, p.startsWith("/") ? path : href));
}

/** Client-side targeting (guides); event_trigger and delay are handled by the caller (they are about when, not whether). */
export function eligible(s: Targeted, ctx: EligibleCtx): boolean {
  const c = s.conditions;
  if (urlExcluded(ctx.url, c.exclude_url_patterns)) return false;
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

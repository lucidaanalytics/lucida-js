import { matchOp } from "@lucida-analytics/sdk-core";
import type { FlagValue, Host } from "../types.js";

/**
 * Recording rules as trigger groups (remote `replay_trigger_groups`, local `trigger_groups`). Groups are
 * OR-ed; inside one group the URL, event and flag conditions combine by `match`; a group without
 * conditions always matches. A matched group still has to be sampled in (per group, deterministic per
 * session), and its `min_duration_ms` then applies. Same semantics in every SDK (testdata/replay/sampling.json).
 */
/** Operators allowed on event-property conditions (the same set the API accepts). */
export type EventPropOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "is_set" | "is_not_set";

/** An event whose properties must all satisfy `properties` (e.g. `purchase` with `amount gt 100`). */
export interface EventFilter {
  event: string;
  properties?: Array<{ key: string; op: EventPropOp; value?: unknown }>;
}

export interface TriggerGroup {
  id: string;
  name?: string;
  match?: "any" | "all";
  /** Regex sources tested against the page URL; once matched it stays matched for the session. */
  url_patterns?: string[];
  events?: string[];
  /** Like `events`, but the event's properties must match too; either list satisfies the event condition. */
  event_filters?: EventFilter[];
  /** Truthy flag, or exactly `variant` when given. */
  flag?: { key: string; variant?: string };
  /** 0..1. Default 1. */
  sample_rate?: number;
  min_duration_ms?: number;
}

export type TriggerState = "disabled" | "pending" | "activated";

/** 32-bit FNV-1a of the UTF-8 bytes. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic sampling decision: the same session and key always land on the same side. */
export function sampled(sessionId: string, key: string, rate: number): boolean {
  return fnv1a32(`${sessionId}:${key}`) / 4294967296 < rate;
}

const flagMatches = (want: { key: string; variant?: string }, flags: Record<string, FlagValue>): boolean => {
  const v = flags[want.key];
  return want.variant === undefined ? v !== undefined && v !== false && v !== "false" : v === want.variant;
};

const hasEvents = (g: TriggerGroup): boolean => !!g.events?.length || !!g.event_filters?.length;

function eventHit(g: TriggerGroup, name: string, props: Record<string, unknown> | undefined): boolean {
  if (g.events?.includes(name)) return true;
  return !!g.event_filters?.some(
    (f) => f.event === name && (f.properties ?? []).every((p) => matchOp(p.op, props?.[p.key], !!props && Object.hasOwn(props, p.key), p.value, false)),
  );
}

const compile = (patterns: string[], log: (...a: unknown[]) => void): RegExp[] =>
  patterns.flatMap((p) => {
    try {
      return [new RegExp(p)];
    } catch {
      log("bad url pattern", p);
      return [];
    }
  });

interface GroupState {
  g: TriggerGroup;
  urls: RegExp[];
  url: boolean;
  event: boolean;
  flag: boolean;
}

function satisfied(s: GroupState): boolean {
  const conds: boolean[] = [];
  if (s.urls.length) conds.push(s.url);
  if (hasEvents(s.g)) conds.push(s.event);
  if (s.g.flag) conds.push(s.flag);
  if (!conds.length) return true;
  return s.g.match === "all" ? conds.every(Boolean) : conds.some(Boolean);
}

export interface GroupWatch {
  checkUrl(url: string): void;
  /** Re-evaluates now (unconditional groups fire on the first check). */
  check(): void;
  stop(): void;
  /** Ids of groups whose conditions are met (sampled in or not). */
  matched(): string[];
  /** Combined condition states, for the `$replay_*_trigger_status` diagnostics. */
  states(): { url: TriggerState; event: TriggerState; flag: TriggerState };
}

/**
 * Watches every group; `fire(group)` runs once, for the first group that is matched and sampled in.
 * `force` skips one condition kind (manual `replay.start({ url_trigger: true })`).
 */
export function watchGroups(
  host: Host,
  groups: TriggerGroup[],
  sessionId: () => string,
  fire: (g: TriggerGroup) => void,
  force: Partial<Record<"url" | "event" | "flag" | "sampling", boolean | undefined>> = {},
): GroupWatch {
  const st: GroupState[] = groups.map((g) => ({ g, urls: compile(g.url_patterns ?? [], host.log), url: !!force.url, event: !!force.event, flag: !!force.flag }));
  let done = false;
  let stopped = false;
  const check = (): void => {
    if (done || stopped) return;
    for (const s of st) {
      if (satisfied(s) && (force.sampling || sampled(sessionId(), s.g.id, s.g.sample_rate ?? 1))) {
        done = true;
        fire(s.g);
        return;
      }
    }
  };
  host.onCapture((e) => {
    let hit = false;
    for (const s of st) if (!s.event && eventHit(s.g, e.event, e.properties)) hit = s.event = true;
    if (hit) check();
  });
  const onFlags = (f: Record<string, FlagValue>): void => {
    let hit = false;
    for (const s of st) if (s.g.flag && !s.flag && flagMatches(s.g.flag, f)) hit = s.flag = true;
    if (hit) check();
  };
  const off = host.flags?.onChange(onFlags);
  const kinds = (has: (s: GroupState) => boolean, on: (s: GroupState) => boolean): TriggerState =>
    !st.some(has) ? "disabled" : st.some((s) => has(s) && on(s)) ? "activated" : "pending";
  return {
    checkUrl(url) {
      let hit = false;
      for (const s of st) if (!s.url && s.urls.some((r) => r.test(url))) hit = s.url = true;
      if (hit) check();
    },
    check,
    stop() {
      stopped = true;
      off?.();
    },
    matched: () => st.filter(satisfied).map((s) => s.g.id),
    states: () => ({
      url: kinds((s) => s.urls.length > 0, (s) => s.url),
      event: kinds((s) => hasEvents(s.g), (s) => s.event),
      flag: kinds((s) => !!s.g.flag, (s) => s.flag),
    }),
  };
}

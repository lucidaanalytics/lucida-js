import type { Core, Props, Storage, WireEvent } from "@lucida/sdk-core";
import { rateLimiter } from "./ratelimit.js";
import type { RateLimitConfig } from "./ratelimit.js";

/** A `beforeSend` hook: return the (possibly amended) event, or null to drop it. */
export type BeforeSend = (event: WireEvent) => WireEvent | null;

export type PersonProfiles = "always" | "identified_only" | "never";

/**
 * Runs hooks in order; each sees the previous hook's output and null stops the chain (the event is dropped).
 * A hook that throws is logged and skipped: the event continues as it was before that hook.
 */
export function runHooks(hooks: readonly BeforeSend[], event: WireEvent, log: (...a: unknown[]) => void): WireEvent | null {
  let cur = event;
  for (const h of hooks) {
    try {
      const next = h(cur);
      if (next === null || next === undefined) return null;
      cur = next;
    } catch (e) {
      log("beforeSend hook threw, keeping event:", e);
    }
  }
  return cur;
}

/** Keeps roughly `rate` (0..1) of events and stamps survivors with `$sample_rate`. */
export function sampleHook(rate: number, random: () => number = Math.random): BeforeSend {
  return (e) => {
    if (rate >= 1) return e;
    if (rate <= 0 || random() >= rate) return null;
    return { ...e, properties: { ...e.properties, $sample_rate: rate } };
  };
}

/** Removes `keys` (exact property names) from the event's properties and from `$set` / `$set_once`. */
export function denylistHook(keys: readonly string[]): BeforeSend {
  const deny = new Set(keys);
  const strip = (p: Props): Props => Object.fromEntries(Object.entries(p).filter(([k]) => !deny.has(k)));
  return (e) => ({
    ...e,
    properties: strip(e.properties),
    ...(e.$set ? { $set: strip(e.$set) } : {}),
    ...(e.$set_once ? { $set_once: strip(e.$set_once) } : {}),
  });
}

const KEY = "lc_person_identified";
const PENDING_KEY = "lc_pending_set_once";
const ALWAYS_PROCESSED = new Set(["$identify", "$create_alias", "$groupidentify"]);
export const INGESTION_WARNING = "$$client_ingestion_warning";
/** At most one rate-limit warning per this window; later drops are counted into the next one. */
export const WARN_WINDOW_MS = 60_000;

/**
 * `personProfiles` state: `identified_only` flips to processing on the first identify/alias/group/person-property
 * write or `createPersonProfile()`. While personless, `$set_once` values (initial referrer, campaign, click ids) are
 * kept (first value wins, consent-gated storage) and sent with the first person-processed event.
 */
export class PersonMode {
  private identified: boolean;
  private pending: Props;

  constructor(
    readonly mode: PersonProfiles,
    private readonly storage: Storage,
  ) {
    this.identified = storage.get(KEY) === "1";
    try {
      this.pending = JSON.parse(storage.get(PENDING_KEY) ?? "{}") as Props;
    } catch {
      this.pending = {};
    }
  }

  get blocksPersonWrites(): boolean {
    return this.mode === "never";
  }

  /** True once events for this visitor create and update a person. */
  get isProfile(): boolean {
    return this.mode === "always" || (this.mode === "identified_only" && this.identified);
  }

  /** Call from identify / alias / group / setPersonProperties. Goes through the consent-gated storage. */
  markIdentified(): void {
    if (this.mode !== "identified_only" || this.identified) return;
    this.identified = true;
    this.storage.set(KEY, "1");
  }

  /** True when an event of this name should carry `$process_person_profile: false`. */
  personless(event: string): boolean {
    if (this.mode === "always") return false;
    if (this.mode === "never") return !ALWAYS_PROCESSED.has(event);
    return !this.identified && !ALWAYS_PROCESSED.has(event);
  }

  /** Keep personless `$set_once` values for later (identified_only only); earlier values win. */
  stash(once: Props | undefined): void {
    if (this.mode !== "identified_only" || !once) return;
    const add = Object.entries(once).filter(([k]) => !(k in this.pending));
    if (!add.length) return;
    this.pending = { ...this.pending, ...Object.fromEntries(add) };
    this.storage.set(PENDING_KEY, JSON.stringify(this.pending));
  }

  /** The kept values (cleared), for the first person-processed event. */
  take(): Props | undefined {
    if (!Object.keys(this.pending).length) return undefined;
    const p = this.pending;
    this.pending = {};
    this.storage.remove(PENDING_KEY);
    return p;
  }

  reset(): void {
    this.identified = false;
    this.pending = {};
    this.storage.remove(KEY);
    this.storage.remove(PENDING_KEY);
  }
}

export interface PolicyOptions {
  hooks: readonly BeforeSend[];
  person: PersonMode;
  limit?: (() => boolean) | undefined;
  log: (...a: unknown[]) => void;
  /** Called for each event the rate limit drops. */
  onLimited?: () => void;
}

/** Person mode, then hooks, then the rate limit, for one event; null drops it. */
export function applyPolicy(o: PolicyOptions, e: WireEvent): WireEvent | null {
  let out = e;
  let taken: Props | undefined;
  if (o.person.personless(e.event)) {
    // Person writes on a personless event are ignored by the worker: do not send them (initial values are kept).
    o.person.stash(e.$set_once);
    const { $set: _s, $set_once: _o, $unset: _u, ...rest } = e;
    out = { ...rest, properties: { ...e.properties, $process_person_profile: false } };
  } else if ((taken = o.person.take())) {
    out = { ...e, $set_once: { ...e.$set_once, ...taken } }; // first-touch values from before win
  }
  let kept = o.hooks.length ? runHooks(o.hooks, out, o.log) : out;
  if (kept && o.limit && !o.limit()) {
    o.log("rate limited, dropped", kept.event);
    o.onLimited?.();
    kept = null;
  }
  if (!kept && taken) o.person.stash(taken); // not sent: keep them for the next one
  return kept;
}

export interface PolicyConfig {
  beforeSend?: BeforeSend | readonly BeforeSend[] | undefined;
  personProfiles?: PersonProfiles | undefined;
  propertyDenylist?: readonly string[] | undefined;
  /** 0..1: keep this share of events, stamping `$sample_rate`. */
  sampleRate?: number | undefined;
  rateLimit?: false | RateLimitConfig | undefined;
}

function hooksOf(c: PolicyConfig): BeforeSend[] {
  const user = c.beforeSend ? (Array.isArray(c.beforeSend) ? c.beforeSend : [c.beforeSend]) : [];
  return [
    ...(c.propertyDenylist?.length ? [denylistHook(c.propertyDenylist)] : []),
    ...(c.sampleRate !== undefined ? [sampleHook(c.sampleRate)] : []),
    ...(user as BeforeSend[]),
  ];
}

/**
 * Routes every event through [applyPolicy] as the Core filter, so capture listeners (inspector, replay triggers)
 * never see an event a hook or the rate limit drops. `c` is read per event, so `setConfig` changes apply at once
 * (`personProfiles` is fixed at start). A rate-limit drop emits `$$client_ingestion_warning` (once per minute,
 * with the count of dropped events), which the limit itself never drops.
 */
export function installPolicy(core: Core, c: PolicyConfig, log: (...a: unknown[]) => void, now: () => number = Date.now): PersonMode {
  const person = new PersonMode(c.personProfiles ?? "always", core.storage);
  let limitOf: PolicyConfig["rateLimit"];
  let limit: (() => boolean) | undefined;
  let dropped = 0;
  let warnedAt = -Infinity;
  const onLimited = (): void => {
    dropped += 1;
    if (now() - warnedAt < WARN_WINDOW_MS) return;
    warnedAt = now();
    queueMicrotask(() => {
      const n = dropped;
      dropped = 0;
      core.capture(INGESTION_WARNING, { $$client_ingestion_warning_message: `client rate limit dropped ${n} event(s)`, $dropped_count: n });
    });
  };
  core.setFilter((e) => {
    if (c.rateLimit !== limitOf) {
      limitOf = c.rateLimit;
      limit = limitOf ? rateLimiter(limitOf) : undefined;
    }
    return applyPolicy({ hooks: hooksOf(c), person, limit: e.event === INGESTION_WARNING ? undefined : limit, log, onLimited }, e);
  });
  return person;
}

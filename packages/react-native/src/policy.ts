import type { Core, Props, Storage, WireEvent } from "@lucida-analytics/sdk-core";

/** A `beforeSend` hook: return the (possibly amended) event, or null to drop it. */
export type BeforeSend = (event: WireEvent) => WireEvent | null;

export type PersonProfiles = "always" | "identified_only" | "never";

/**
 * Runs hooks in order; each sees the previous hook's output and null stops the chain (the event is dropped).
 * A hook that throws is logged and skipped: the event continues unchanged (as it was before that hook).
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

/** Keeps roughly `rate` (0..1) of events and stamps survivors with `$sample_rate`. Compose it with your own filter hook. */
export function sampleHook(rate: number, random: () => number = Math.random): BeforeSend {
  return (e) => {
    if (rate >= 1) return e;
    if (rate <= 0 || random() >= rate) return null;
    return { ...e, properties: { ...e.properties, $sample_rate: rate } };
  };
}

const KEY = "lc_person_identified";
const ALWAYS_PROCESSED = new Set(["$identify", "$create_alias", "$groupidentify"]);

/** `personProfiles` state: `identified_only` flips to processing on the first identify/alias/group/person-property write. */
export class PersonMode {
  private identified: boolean;

  constructor(
    readonly mode: PersonProfiles,
    private readonly storage: Storage,
  ) {
    this.identified = storage.get(KEY) === "1";
  }

  get blocksPersonWrites(): boolean {
    return this.mode === "never";
  }

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

  reset(): void {
    this.identified = false;
    this.storage.remove(KEY);
  }
}

export interface PolicyOptions {
  beforeSend?: readonly BeforeSend[] | undefined;
  personProfiles?: PersonProfiles | undefined;
  disableGeoip?: boolean | undefined;
  log: (...a: unknown[]) => void;
}

/** Applies person mode, geoip and hooks to one event; null drops it. */
export function applyPolicy(person: PersonMode, o: PolicyOptions, e: WireEvent): WireEvent | null {
  const writes = !!(e.$set || e.$set_once || e.$unset);
  if (writes || ALWAYS_PROCESSED.has(e.event)) person.markIdentified();
  let out: WireEvent = e;
  if (person.blocksPersonWrites && writes) {
    o.log("personProfiles=never: ignoring $set/$set_once on", e.event);
    const { $set: _s, $set_once: _o, $unset: _u, ...rest } = e;
    out = rest;
  }
  const extra: Props = {};
  if (person.personless(e.event)) extra.$process_person_profile = false;
  if (o.disableGeoip) extra.$geoip_disable = true;
  if (Object.keys(extra).length) out = { ...out, properties: { ...out.properties, ...extra } };
  return o.beforeSend?.length ? runHooks(o.beforeSend, out, o.log) : out;
}

/**
 * Routes every event through [applyPolicy] as the Core filter (also events held before consent), so capture
 * listeners (replay, guides) never see an event a hook drops.
 */
export function installPolicy(core: Core, o: PolicyOptions): PersonMode {
  const person = new PersonMode(o.personProfiles ?? "always", core.storage);
  core.setFilter((e) => applyPolicy(person, o, e));
  return person;
}

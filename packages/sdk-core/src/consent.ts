import type { Storage } from "./ports.js";

export type ConsentCategory = "analytics" | "replay" | "marketing";
export type ConsentMode = "opt_in" | "opt_out";
export type ConsentState = Record<ConsentCategory, boolean>;
/** `pending` until the visitor made an explicit choice (stored, or set() called), whatever the mode's default. */
export type ConsentStatus = "granted" | "denied" | "pending";
/** What a geo consent rule (N-ANA-17, `consent_default` in `GET /v1/config`) starts a visitor in. */
export type ConsentDefault = "opt_in" | "opt_out" | "cookieless";

/** Default storage key of the stored decision. */
export const CONSENT_KEY = "lc_consent";
/**
 * Mode a visitor without a stored decision starts in, from the page's `consent.mode`, the project's `consent_mode`
 * and the geo `consent_default` of `GET /v1/config` (testdata/consent/precedence.json). Precedence (a stored visitor
 * decision beats all of this, and skips the wait): the project, then the page. The project can only make it stricter:
 * `opt_in` always wins; a project `opt_out` never loosens a page `opt_in`. undefined keeps the page mode.
 */
export function resolveConsentDefault(page: ConsentMode, projectMode?: string, geo?: string): ConsentDefault | undefined {
  if (projectMode === "opt_in") return "opt_in";
  if (geo === "opt_in" || geo === "opt_out" || geo === "cookieless") return geo;
  return projectMode === "opt_out" ? page : undefined;
}

const CATEGORIES: ConsentCategory[] = ["analytics", "replay", "marketing"];

export interface ConsentOptions {
  /** `opt_out` (the default) stores and sends before any visitor choice; use `opt_in` where consent law requires prior consent. */
  mode?: ConsentMode;
  /** Hold events in memory (never stored/sent) until analytics is granted. Default false = drop. */
  queueBeforeConsent?: boolean;
  /** opt_out mode only: treat Do Not Track / Global Privacy Control as a denial. */
  respectDnt?: boolean;
  dnt?: boolean;
  /** Storage key of the stored decision (default `lc_consent`); set it to share one decision across SDK instances or to match your CMP. */
  storageKey?: string;
  /**
   * Wait for the project's geo consent default (resolve()) before anything is stored or sent: until then every
   * category is denied and events are held in memory. A stored decision skips the wait.
   */
  awaitRemote?: boolean;
  /** Real (ungated) storage. Persisted only after an explicit set(). */
  storage: Storage;
}

/**
 * Consent state machine. opt_in: every category starts denied and nothing is persisted until
 * set() is called. opt_out: categories start granted unless DNT/GPC is honoured or a stored
 * decision says otherwise. With awaitRemote the mode comes from the geo default (resolve()).
 */
export class Consent {
  private modeNow: ConsentMode;
  readonly queueBeforeConsent: boolean;
  private state: ConsentState;
  private decided = false;
  private waiting: boolean;
  private geoCookieless = false;
  private readonly key: string;
  private listeners: Array<(s: ConsentState, prev: ConsentState) => void> = [];

  constructor(private readonly o: ConsentOptions) {
    this.modeNow = o.mode ?? "opt_out";
    this.queueBeforeConsent = o.queueBeforeConsent ?? false;
    const open = this.opens();
    this.state = { analytics: open, replay: open, marketing: open };
    this.key = o.storageKey || CONSENT_KEY;
    // Reading is allowed; only writes are gated.
    const raw = o.storage.get(this.key);
    if (raw) {
      try {
        const s = JSON.parse(raw) as Partial<ConsentState>;
        for (const c of CATEGORIES) if (typeof s[c] === "boolean") this.state[c] = s[c] as boolean;
        this.decided = CATEGORIES.some((c) => typeof s[c] === "boolean");
      } catch {
        /* corrupt stored consent: keep defaults */
      }
    }
    // A stored decision needs no geo default.
    this.waiting = !!o.awaitRemote && !this.decided;
    if (this.waiting) this.state = { analytics: false, replay: false, marketing: false };
  }

  /** Whether the current mode starts categories granted. */
  private opens(): boolean {
    return this.modeNow === "opt_out" && !(this.o.respectDnt && this.o.dnt);
  }

  /** The effective mode: the local one, or the geo default once resolve() applied it. */
  get mode(): ConsentMode {
    return this.modeNow;
  }

  /** True until resolve() ran on a consent that awaits the remote geo default. */
  get resolving(): boolean {
    return this.waiting;
  }

  /** True while a geo `cookieless` default applies: events go out without ids and nothing is stored. */
  get anonymous(): boolean {
    return this.geoCookieless && !this.decided;
  }

  /**
   * Apply the project's geo default (`consent_default` from `GET /v1/config`; undefined = no rule matched, keep the
   * local mode). Only the first call counts, and only before an explicit decision. Returns true when analytics is
   * now granted.
   */
  resolve(def: ConsentDefault | undefined): boolean {
    if (!this.waiting) return this.state.analytics;
    this.waiting = false;
    if (def === "opt_in" || def === "opt_out") this.modeNow = def;
    this.geoCookieless = def === "cookieless";
    const open = !this.geoCookieless && this.opens();
    this.state = { analytics: open, replay: open, marketing: open };
    return open;
  }

  get(): ConsentState {
    return { ...this.state };
  }

  has(c: ConsentCategory): boolean {
    return this.state[c];
  }

  /** Tri-state status of a category: `pending` before an explicit decision, then granted or denied. */
  status(c: ConsentCategory = "analytics"): ConsentStatus {
    if (!this.decided) return "pending";
    return this.state[c] ? "granted" : "denied";
  }

  /** True while an opt_in project is still waiting for an analytics decision, or the geo default is unresolved. */
  get pending(): boolean {
    return this.waiting || (this.modeNow === "opt_in" && !this.state.analytics);
  }

  /** Record a decision (partial update), persist it, notify listeners. */
  set(update: Partial<ConsentState>): void {
    const prev = this.get();
    for (const c of CATEGORIES) if (update[c] !== undefined) this.state[c] = update[c] as boolean;
    this.decided = true;
    this.waiting = false;
    this.o.storage.set(this.key, JSON.stringify(this.state));
    for (const l of this.listeners) l(this.get(), prev);
  }

  onChange(fn: (s: ConsentState, prev: ConsentState) => void): void {
    this.listeners.push(fn);
  }
}

/**
 * Storage decorator that keeps writes in memory until `allowed()` is true, then flushes them.
 * Guarantees "no storage writes before consent" for identity/session/super-property state.
 */
export class GatedStorage implements Storage {
  private mem = new Map<string, string | null>();

  constructor(
    private readonly inner: Storage,
    private readonly allowed: () => boolean,
  ) {}

  get(key: string): string | null {
    return this.mem.has(key) ? (this.mem.get(key) ?? null) : this.inner.get(key);
  }

  set(key: string, value: string): void {
    if (this.allowed()) this.inner.set(key, value);
    else this.mem.set(key, value);
  }

  remove(key: string): void {
    if (this.allowed()) this.inner.remove(key);
    else this.mem.set(key, null);
  }

  /** Persist everything buffered; call right after consent is granted. */
  flushBuffered(): void {
    for (const [k, v] of this.mem) v === null ? this.inner.remove(k) : this.inner.set(k, v);
    this.mem.clear();
  }

  /** Forget buffered writes (consent denied). */
  discardBuffered(): void {
    this.mem.clear();
  }
}

import type { Storage } from "./ports.js";

export type ConsentCategory = "analytics" | "replay" | "marketing";
export type ConsentMode = "opt_in" | "opt_out";
export type ConsentState = Record<ConsentCategory, boolean>;
/** `pending` until the visitor made an explicit choice (stored, or set() called), whatever the mode's default. */
export type ConsentStatus = "granted" | "denied" | "pending";

/** Default storage key of the stored decision. */
export const CONSENT_KEY = "lc_consent";
const CATEGORIES: ConsentCategory[] = ["analytics", "replay", "marketing"];

export interface ConsentOptions {
  mode?: ConsentMode;
  /** Hold events in memory (never stored/sent) until analytics is granted. Default false = drop. */
  queueBeforeConsent?: boolean;
  /** opt_out mode only: treat Do Not Track / Global Privacy Control as a denial. */
  respectDnt?: boolean;
  dnt?: boolean;
  /** Storage key of the stored decision (default `lc_consent`); set it to share one decision across SDK instances or to match your CMP. */
  storageKey?: string;
  /** Real (ungated) storage. Persisted only after an explicit set(). */
  storage: Storage;
}

/**
 * Consent state machine. opt_in: every category starts denied and nothing is persisted until
 * set() is called. opt_out: categories start granted unless DNT/GPC is honoured or a stored
 * decision says otherwise.
 */
export class Consent {
  readonly mode: ConsentMode;
  readonly queueBeforeConsent: boolean;
  private state: ConsentState;
  private decided = false;
  private readonly key: string;
  private listeners: Array<(s: ConsentState, prev: ConsentState) => void> = [];

  constructor(private readonly o: ConsentOptions) {
    this.mode = o.mode ?? "opt_out";
    this.queueBeforeConsent = o.queueBeforeConsent ?? false;
    const open = this.mode === "opt_out" && !(o.respectDnt && o.dnt);
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

  /** True while an opt_in project is still waiting for an analytics decision. */
  get pending(): boolean {
    return this.mode === "opt_in" && !this.state.analytics;
  }

  /** Record a decision (partial update), persist it, notify listeners. */
  set(update: Partial<ConsentState>): void {
    const prev = this.get();
    for (const c of CATEGORIES) if (update[c] !== undefined) this.state[c] = update[c] as boolean;
    this.decided = true;
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

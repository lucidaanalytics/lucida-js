import type { Storage } from "@lucida-analytics/sdk-core";
import type { Persistence } from "./types.js";

export class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string): void {
    this.m.set(k, v);
  }
  remove(k: string): void {
    this.m.delete(k);
  }
}

const YEAR_DAYS = 365;

export interface CookieOptions {
  /** Force the Secure attribute on/off (default: on when the page is https). */
  secure?: boolean;
  /** Lifetime in days (default 365). */
  expiryDays?: number;
  /** Share the cookie across subdomains: the broadest registrable domain the browser accepts is used. */
  crossSubdomain?: boolean;
  /** Explicit cookie Domain (wins over crossSubdomain). */
  domain?: string;
}

// Listed private-registry suffixes (hosting platforms); country-code second levels follow the rule below.
const MULTI_LABEL_SUFFIXES = new Set(
  (
    "co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk com.au net.au org.au edu.au gov.au co.nz org.nz net.nz " +
    "co.jp ne.jp or.jp ac.jp go.jp co.kr or.kr com.cn net.cn org.cn com.hk com.tw com.sg com.my co.in net.in org.in " +
    "co.id co.th com.ph com.vn com.br net.br org.br com.ar com.mx com.co com.pe com.tr com.ua com.pl co.za co.il " +
    "com.eg com.sa com.ng co.ke " +
    "github.io gitlab.io vercel.app netlify.app herokuapp.com pages.dev workers.dev web.app firebaseapp.com " +
    "azurewebsites.net cloudfront.net appspot.com onrender.com fly.dev glitch.me repl.co blogspot.com wordpress.com " +
    "myshopify.com vercel.dev netlify.com surge.sh render.com railway.app koyeb.app deno.dev " +
    "ngrok.io ngrok-free.app trycloudflare.com cloudfunctions.net run.app s3.amazonaws.com elasticbeanstalk.com " +
    "azurestaticapps.net wixsite.com webflow.io framer.app bubbleapps.io"
  ).split(" "),
);

// Under a two-letter country TLD these second-level labels are registry suffixes (co.xx, com.xx, ...): this covers
// most of the public suffix list's country entries without shipping the list itself.
const CC_SECOND_LEVEL = new Set("co com net org edu gov gob go ac or ne ltd plc sch mil nom".split(" "));

/** Registrable domain (eTLD+1) of `host` when its public suffix is a known multi-label one, else undefined. */
export function knownRegistrable(host: string): string | undefined {
  const parts = host.toLowerCase().split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    if (MULTI_LABEL_SUFFIXES.has(parts.slice(i).join("."))) return parts.slice(i - 1).join(".");
    if (i === parts.length - 2 && parts[i + 1]!.length === 2 && CC_SECOND_LEVEL.has(parts[i]!)) {
      return parts.slice(i - 1).join(".");
    }
  }
  return undefined;
}

/**
 * Broadest parent domain this browser lets us set a cookie on (probes with a short-lived cookie). When no probe
 * sticks (cookies blocked or read back filtered), a known multi-label suffix still gives the registrable domain.
 */
export function broadestDomain(host: string = location.hostname): string | undefined {
  if (/^[\d.]+$/.test(host) || host.includes(":")) return undefined;
  const parts = host.split(".");
  for (let i = parts.length - 2; i >= 0; i--) {
    const cand = parts.slice(i).join(".");
    document.cookie = `__lc_probe=1; Domain=${cand}; Path=/; Max-Age=10; SameSite=Lax`;
    if (document.cookie.includes("__lc_probe=1")) {
      document.cookie = `__lc_probe=; Domain=${cand}; Path=/; Max-Age=0`;
      return cand;
    }
  }
  return knownRegistrable(host);
}

export class CookieStorage implements Storage {
  private domain: string | undefined | null = null; // null = not resolved yet

  constructor(private readonly o: CookieOptions = {}) {}

  /** Resolved on first write, which only ever happens after consent (the probe is a cookie write too). */
  private attr(): string {
    if (this.domain === null) {
      try {
        this.domain = this.o.domain ?? (this.o.crossSubdomain ? broadestDomain() : undefined);
      } catch {
        this.domain = undefined;
      }
    }
    return this.domain ? `; Domain=${this.domain}` : "";
  }

  // Values the browser would not keep (sandboxed iframe, data: page, cookies blocked, over the ~4 KB cookie limit)
  // stay in memory for the page, so identity still holds within it instead of the SDK throwing or regenerating.
  private readonly held = new Map<string, string>();

  private read(k: string): string | null {
    try {
      for (const part of document.cookie.split("; ")) {
        const i = part.indexOf("=");
        if (part.slice(0, i) === k) return decodeURIComponent(part.slice(i + 1));
      }
    } catch {
      /* cookie access denied or a malformed escape */
    }
    return null;
  }
  get(k: string): string | null {
    return this.read(k) ?? this.held.get(k) ?? null;
  }
  set(k: string, v: string): void {
    const secure = (this.o.secure ?? location.protocol === "https:") ? "; Secure" : "";
    const age = Math.round((this.o.expiryDays ?? YEAR_DAYS) * 86400);
    try {
      document.cookie = `${k}=${encodeURIComponent(v)}; Max-Age=${age}; Path=/${this.attr()}; SameSite=Lax${secure}`;
    } catch {
      /* falls through to the read-back check */
    }
    if (this.read(k) === v) this.held.delete(k);
    else this.held.set(k, v);
  }
  remove(k: string): void {
    this.held.delete(k);
    try {
      document.cookie = `${k}=; Max-Age=0; Path=/${this.attr()}; SameSite=Lax`;
    } catch {
      /* nothing to delete */
    }
  }
}

/** `localStorage` or `sessionStorage`; a blocked or full store keeps state in memory for the page. */
export class WebStorageAdapter implements Storage {
  constructor(private readonly kind: "localStorage" | "sessionStorage" = "localStorage") {}
  private store(): globalThis.Storage | undefined {
    try {
      return globalThis[this.kind];
    } catch {
      return undefined;
    }
  }
  get(k: string): string | null {
    try {
      return this.store()?.getItem(k) ?? null;
    } catch {
      return null;
    }
  }
  set(k: string, v: string): void {
    try {
      this.store()?.setItem(k, v);
    } catch {
      /* quota or blocked storage: state stays in memory for this page */
    }
  }
  remove(k: string): void {
    try {
      this.store()?.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

export class LocalStorageAdapter extends WebStorageAdapter {
  constructor() {
    super("localStorage");
  }
}

/** Keys `localStorage+cookie` keeps in the cookie too: small, identity-critical, shared across subdomains. */
export const COOKIE_KEYS = ["lc_identity", "lc_session", "lc_device_id", "lc_consent", "lc_person_identified"];

/**
 * `localStorage+cookie`: identity keys are written to both (the cookie spans subdomains, localStorage survives cookie
 * expiry or clearing); everything else goes to localStorage only, keeping cookies small. Conflict rule on read:
 * an identity key takes the cookie value when both exist (other subdomains write the cookie), other keys take
 * localStorage; either falls back to the other store, so switching from `cookie` or `localStorage` keeps state.
 * Reads never write: the stores realign on the next write, which only happens after consent.
 */
export class CombinedStorage implements Storage {
  constructor(
    private readonly cookie: Storage,
    private readonly local: Storage,
    private readonly cookieKeys: (k: string) => boolean,
  ) {}
  get(k: string): string | null {
    const [first, second] = this.cookieKeys(k) ? [this.cookie, this.local] : [this.local, this.cookie];
    return first.get(k) ?? second.get(k);
  }
  set(k: string, v: string): void {
    this.local.set(k, v);
    if (this.cookieKeys(k)) this.cookie.set(k, v);
    else this.cookie.remove(k); // a value left from plain cookie mode would shadow nothing but still ride every request
  }
  remove(k: string): void {
    this.local.remove(k);
    this.cookie.remove(k);
  }
}

/**
 * Coalesces writes: they are served from memory at once and reach the inner store `delayMs` later (cookies are
 * rewritten on every event otherwise). `flush()` writes now; the client calls it on page hide and shutdown.
 */
export class DebouncedStorage implements Storage {
  private pending = new Map<string, string | null>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly inner: Storage,
    private readonly delayMs: number,
  ) {}
  get(k: string): string | null {
    return this.pending.has(k) ? (this.pending.get(k) ?? null) : this.inner.get(k);
  }
  set(k: string, v: string): void {
    this.queue(k, v);
  }
  remove(k: string): void {
    this.queue(k, null);
  }
  private queue(k: string, v: string | null): void {
    this.pending.set(k, v);
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const [k, v] of this.pending) v === null ? this.inner.remove(k) : this.inner.set(k, v);
    this.pending.clear();
  }
}

/** Namespaces keys per project token so several projects can share a page. */
class Prefixed implements Storage {
  constructor(
    private readonly inner: Storage,
    private readonly suffix: string,
  ) {}
  get(k: string): string | null {
    return this.inner.get(k + this.suffix);
  }
  set(k: string, v: string): void {
    this.inner.set(k + this.suffix, v);
  }
  remove(k: string): void {
    this.inner.remove(k + this.suffix);
  }
}

export const keySuffix = (apiKey: string): string => `_${apiKey.replace(/\W/g, "").slice(-8)}`;

/** The raw store for a persistence mode (namespaced per project); "memory" and "none" never touch the browser. */
export function createStorage(kind: Persistence, apiKey: string, cookie?: CookieOptions): Storage {
  if (kind === "memory" || kind === "none") return new MemoryStorage();
  const suffix = keySuffix(apiKey);
  const inner =
    kind === "cookie"
      ? new CookieStorage(cookie)
      : kind === "localStorage+cookie"
        ? new CombinedStorage(new CookieStorage(cookie), new LocalStorageAdapter(), (k) => COOKIE_KEYS.some((c) => k === c + suffix))
        : new WebStorageAdapter(kind);
  return new Prefixed(inner, suffix);
}

/**
 * Consent denied: removes every stored `lc_*` item of this project (cookies, localStorage, sessionStorage) except the
 * decision itself (`keep`, the consent key), which must survive so the choice is remembered.
 */
export function purgeStored(store: Storage, apiKey: string, keep: string): void {
  const suffix = keySuffix(apiKey);
  const names = new Set<string>();
  try {
    for (const part of document.cookie.split("; ")) names.add(part.split("=")[0]!);
    for (const s of [globalThis.localStorage, globalThis.sessionStorage]) for (let i = 0; i < s.length; i++) names.add(s.key(i)!);
  } catch {
    /* storage blocked: nothing more to purge */
  }
  for (const n of names) {
    if (!n.startsWith("lc_") || !n.endsWith(suffix) || n === keep + suffix) continue;
    store.remove(n.slice(0, -suffix.length));
    try {
      localStorage.removeItem(n);
      sessionStorage.removeItem(n);
    } catch {
      /* blocked */
    }
  }
}

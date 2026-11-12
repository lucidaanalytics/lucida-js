import type { Host, Module } from "../types.js";
import { applyConsent } from "./record.js";

/** Bridge decisions: skip unchanged re-announcements, mirror the decision into the first-party `lc_consent` cookie (read by the Next edge helpers). */
const CMP = { onlyIfChanged: true, cookie: true } as const;

type Update = { analytics?: boolean; replay?: boolean; marketing?: boolean };

interface TCData {
  eventStatus?: string;
  gdprApplies?: boolean;
  listenerId?: number;
  purpose?: { consents?: Record<string, boolean> };
}
type TcfApi = (cmd: string, version: number, cb: (d: TCData, ok: boolean) => void, param?: number) => void;

/**
 * TCF v2.2 purposes -> Lucida categories. analytics = purpose 1 (store/access) + 7 (measure ad
 * performance); replay = analytics + 8 (measure content performance); marketing = 1 + 4 (select
 * personalised ads). Returns undefined when the framework says GDPR does not apply (no signal).
 */
export function tcfToConsent(d: TCData): Update | undefined {
  if (d.gdprApplies === false) return undefined;
  const c = d.purpose?.consents ?? {};
  const analytics = !!c[1] && !!c[7];
  return { analytics, replay: analytics && !!c[8], marketing: !!c[1] && !!c[4] };
}

/**
 * Consent Mode v2 states -> Lucida categories. analytics_storage drives analytics and replay (no
 * dedicated signal for replay); ad_storage + ad_user_data drive marketing. Only keys present in
 * the update are mapped.
 */
export function gcmToConsent(s: Record<string, unknown>): Update {
  const g = (k: string): boolean | undefined => (k in s ? s[k] === "granted" : undefined);
  const out: Update = {};
  const a = g("analytics_storage");
  if (a !== undefined) out.analytics = out.replay = a;
  const ad = g("ad_storage");
  const user = g("ad_user_data");
  if (ad !== undefined) out.marketing = ad && user !== false;
  return out;
}

/** OneTrust active groups (`,C0001,C0002,` string or array) -> categories: C0002 (performance) = analytics + replay, C0004 (targeting) = marketing. */
export function oneTrustToConsent(groups: string | string[]): Update {
  const g = typeof groups === "string" ? groups.split(",") : groups;
  const analytics = g.includes("C0002");
  return { analytics, replay: analytics, marketing: g.includes("C0004") };
}

/** Cookiebot consent object: statistics = analytics + replay, marketing = marketing. */
export function cookiebotToConsent(c: { statistics?: boolean; marketing?: boolean }): Update {
  return { analytics: !!c.statistics, replay: !!c.statistics, marketing: !!c.marketing };
}

type CmSnapshot = Record<string, boolean | undefined>;

/** Remember every named CMP category of a decision (Cookie Munch "referrals", ...) for options gated on a category (`referralParams.category`). */
function noteCategories(host: Host, snapshot: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(snapshot)) if (typeof v === "boolean") host.categoryGrants.set(k, v);
}

/** Cookie Munch snapshot (`CookieMunch.consent`): statistics = analytics + replay (or analytics only, with `replayCategory` naming a separate Cookie Munch category for replay), marketing = marketing. `preferences` has no Lucida category (it gates the site's own storage, not Lucida's). */
export function cookieMunchToConsent(c: CmSnapshot, replayCategory?: string): Update {
  return { analytics: !!c.statistics, replay: replayCategory ? !!c[replayCategory] : !!c.statistics, marketing: !!c.marketing };
}

/** Follow an IAB TCF v2.2 CMP (`window.__tcfapi`); waits up to 10 s for the CMP to appear. */
export const tcfConsent: Module = (host) => {
  let removeId: number | undefined;
  const attach = (): boolean => {
    const api = (window as { __tcfapi?: TcfApi }).__tcfapi;
    if (typeof api !== "function") return false;
    api("addEventListener", 2, (d, ok) => {
      if (!ok || (d.eventStatus !== "tcloaded" && d.eventStatus !== "useractioncomplete")) return;
      removeId = d.listenerId;
      const u = tcfToConsent(d);
      if (u) applyConsent(host, u, "tcf", CMP);
    });
    return true;
  };
  const stop = whenReady(attach);
  return () => {
    stop();
    const api = (window as { __tcfapi?: TcfApi }).__tcfapi;
    if (removeId !== undefined && typeof api === "function") api("removeEventListener", 2, () => {}, removeId);
  };
};

/** Follow Google Consent Mode v2: `gtag('consent', 'default'|'update', {...})` entries on dataLayer. */
export const gcmConsent: Module = (host) => {
  const w = window as unknown as { dataLayer?: unknown[] };
  const layer = (w.dataLayer ??= []);
  const seen = (entry: unknown): void => {
    const a = entry as ArrayLike<unknown> | null;
    if (a && typeof a === "object" && a[0] === "consent" && (a[1] === "default" || a[1] === "update") && a[2] && typeof a[2] === "object") {
      applyConsent(host, gcmToConsent(a[2] as Record<string, unknown>), "gcm", CMP);
    }
  };
  layer.forEach(seen);
  const push = layer.push;
  layer.push = function (...items: unknown[]) {
    items.forEach(seen);
    return push.apply(this, items);
  };
  return () => {
    layer.push = push;
  };
};

/** Follow OneTrust: `OnetrustActiveGroups` now, and the `OneTrustGroupsUpdated` window event. */
export const oneTrustConsent: Module = (host) => {
  const read = (groups: unknown): void => {
    if (typeof groups === "string" || Array.isArray(groups)) applyConsent(host, oneTrustToConsent(groups as string | string[]), "onetrust", CMP);
  };
  const w = window as { OnetrustActiveGroups?: string };
  const on = (e: Event): void => read((e as CustomEvent<string[]>).detail ?? w.OnetrustActiveGroups);
  window.addEventListener("OneTrustGroupsUpdated", on);
  read(w.OnetrustActiveGroups);
  return () => window.removeEventListener("OneTrustGroupsUpdated", on);
};

/** Follow Cookiebot: `Cookiebot.consent` once the visitor has answered, then its accept/decline events. */
export const cookiebotConsent: Module = (host) => {
  const w = window as { Cookiebot?: { hasResponse?: boolean; consent?: { statistics?: boolean; marketing?: boolean } } };
  const read = (): void => {
    const cb = w.Cookiebot;
    if (!cb?.consent || cb.hasResponse === false) return;
    noteCategories(host, cb.consent);
    applyConsent(host, cookiebotToConsent(cb.consent), "cookiebot", CMP);
  };
  const events = ["CookiebotOnConsentReady", "CookiebotOnAccept", "CookiebotOnDecline"];
  for (const e of events) window.addEventListener(e, read);
  read();
  return () => events.forEach((e) => window.removeEventListener(e, read));
};

type OsanoConsent = Record<string, string | undefined>;
interface OsanoCm {
  getConsent?: () => OsanoConsent;
  addEventListener?: (name: string, cb: (c: OsanoConsent) => void) => void;
  removeEventListener?: (name: string, cb: (c: OsanoConsent) => void) => void;
}

/** Osano consent (`ANALYTICS` / `MARKETING`: "ACCEPT" | "DENY"): analytics = analytics + replay, marketing = marketing. */
export function osanoToConsent(c: OsanoConsent): Update {
  const analytics = c.ANALYTICS === "ACCEPT";
  return { analytics, replay: analytics, marketing: c.MARKETING === "ACCEPT" };
}

/** Retries `ready` every 250 ms for up to 10 s (CMPs load async); returns the stop. */
function whenReady(ready: () => boolean): () => void {
  if (ready()) return () => {};
  let tries = 0;
  const t = setInterval(() => (ready() || ++tries > 40) && clearInterval(t), 250);
  return () => clearInterval(t);
}

const OSANO_EVENTS = ["osano-cm-initialized", "osano-cm-consent-saved", "osano-cm-consent-changed"];

/** Follow Osano (`Osano.cm`): its current consent once loaded, then its consent events. */
export const osanoConsent: Module = (host) => {
  let cm: OsanoCm | undefined;
  const on = (c: OsanoConsent | undefined): void => {
    const cur = c && typeof c === "object" && Object.keys(c).length ? c : cm?.getConsent?.();
    if (cur && Object.keys(cur).length) applyConsent(host, osanoToConsent(cur), "osano", CMP);
  };
  const stop = whenReady(() => {
    cm = (window as { Osano?: { cm?: OsanoCm } }).Osano?.cm;
    if (!cm) return false;
    for (const e of OSANO_EVENTS) cm.addEventListener?.(e, on);
    on(cm.getConsent?.());
    return true;
  });
  return () => {
    stop();
    for (const e of OSANO_EVENTS) cm?.removeEventListener?.(e, on);
  };
};

export interface UcService {
  name: string;
  categorySlug?: string;
  consent?: { status?: boolean };
}

/**
 * Usercentrics services -> categories: the service named `serviceName` (add Lucida as a service in Usercentrics)
 * drives analytics + replay; marketing needs every service in the `marketing` category. Undefined when the
 * service is not listed (no signal).
 */
export function usercentricsToConsent(services: readonly UcService[], serviceName = "Lucida"): Update | undefined {
  const own = services.find((s) => s.name.toLowerCase() === serviceName.toLowerCase());
  if (!own) return undefined;
  const analytics = own.consent?.status === true;
  const ads = services.filter((s) => s.categorySlug === "marketing");
  return { analytics, replay: analytics, marketing: ads.length > 0 && ads.every((s) => s.consent?.status === true) };
}

const UC_EVENTS = ["UC_UI_INITIALIZED", "UC_UI_CMP_EVENT", "ucEvent", "UC_CONSENT"];

/** Follow Usercentrics (v2 `UC_UI` API) for the given service name; re-reads on its window events. */
export function usercentricsBridge(serviceName = "Lucida"): Module {
  return (host) => {
    const read = (): boolean => {
      const ui = (window as { UC_UI?: { getServicesBaseInfo?: () => UcService[] } }).UC_UI;
      const list = ui?.getServicesBaseInfo?.();
      if (!list) return false;
      const u = usercentricsToConsent(list, serviceName);
      if (u) applyConsent(host, u, "usercentrics", CMP);
      else host.log(`usercentrics: no service named "${serviceName}"; consent left unchanged`);
      return true;
    };
    const on = (): void => void read();
    for (const e of UC_EVENTS) window.addEventListener(e, on);
    const stop = whenReady(read);
    return () => {
      stop();
      for (const e of UC_EVENTS) window.removeEventListener(e, on);
    };
  };
}

/** Usercentrics bridge for a service named "Lucida". */
export const usercentricsConsent: Module = usercentricsBridge();

const CM_EVENTS = ["CookieMunchOnConsentReady", "CookieMunchOnChange"];

interface CmGlobal {
  hasResponse?: boolean;
  consent?: CmSnapshot;
  receiptId?: unknown;
  consentReceiptId?: unknown;
  consentId?: unknown;
  ledgerId?: unknown;
}

/** The receipt / ledger id Cookie Munch exposes for the visitor's current decision (event detail first, then the global), if any. */
function receiptOf(cm: CmGlobal, e?: Event): string | undefined {
  const d = ((e as CustomEvent<CmGlobal | undefined> | undefined)?.detail ?? {}) as CmGlobal;
  for (const v of [d.receiptId, d.consentReceiptId, d.consentId, d.ledgerId, cm.receiptId, cm.consentReceiptId, cm.consentId, cm.ledgerId]) {
    if (typeof v === "string" && v) return v.slice(0, 128);
  }
  return undefined;
}

/**
 * Cookie Munch bridge with options. `replayCategory`: name of a custom Cookie Munch category that gates session
 * replay on its own (default: replay follows `statistics`).
 */
export function cookieMunchBridge(o: { replayCategory?: string } = {}): Module {
  return (host) => {
    const read = (e?: Event): void => {
      const cm = (window as { CookieMunch?: CmGlobal }).CookieMunch;
      if (!cm?.consent || cm.hasResponse !== true) return;
      noteCategories(host, cm.consent);
      const receiptId = receiptOf(cm, e);
      applyConsent(host, cookieMunchToConsent(cm.consent, o.replayCategory), "cookiemunch", { ...CMP, ...(receiptId ? { receiptId } : {}) });
    };
    for (const e of CM_EVENTS) window.addEventListener(e, read);
    read();
    return () => CM_EVENTS.forEach((e) => window.removeEventListener(e, read));
  };
}

/**
 * Follow Cookie Munch (cookiemunch.net): `CookieMunch.consent` once the visitor has a decision (`hasResponse`; the
 * snapshot is all-false before that, which is never read as a decline), then its change events. Cookie Munch is
 * Cookiebot-compatible, so `cookiebotConsent` also works; this one uses the native event names.
 */
export const cookieMunchConsent: Module = cookieMunchBridge();

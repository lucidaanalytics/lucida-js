import type { Storage } from "@lucida/sdk-core";
import { CLICK_IDS } from "../clickids.js";
import { UTM_PARAMS } from "../env.js";
import type { Host, Module } from "../types.js";

const INITIAL_KEY = "lc_flag_initial";

function referringDomain(ref: string): string {
  try {
    return ref ? new URL(ref).hostname : "";
  } catch {
    return "";
  }
}

/** First-touch web properties as of the first page this browser was seen on (UTMs, click ids, referrer). */
function firstTouch(): Record<string, string> {
  const q = new URLSearchParams(location.search);
  const out: Record<string, string> = {
    $initial_referrer: document.referrer || "$direct",
    $initial_referring_domain: referringDomain(document.referrer) || "$direct",
    $initial_current_url: location.href.split("#")[0] as string,
  };
  for (const k of [...UTM_PARAMS, ...CLICK_IDS]) {
    const v = q.get(k);
    if (v) out[`$initial_${k}`] = v;
  }
  return out;
}

/**
 * `$initial_*` person properties sent with flag requests, so a flag can target campaign or referrer
 * before the person profile has them. Kept once per browser, written only after consent.
 */
export function flagWebProps(storage: Storage, whenConsented: (fn: () => void) => void): Record<string, string> {
  if (typeof location === "undefined") return {};
  const saved = storage.get(INITIAL_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as Record<string, string>;
    } catch {
      /* recompute */
    }
  }
  const t = firstTouch();
  whenConsented(() => {
    if (!storage.get(INITIAL_KEY)) storage.set(INITIAL_KEY, JSON.stringify(t));
  });
  return t;
}

/** Browser name and OS from the user agent (coarse families; no versions). */
function uaFamilies(): { browser: string; os: string } {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "Mac OS X" : /CrOS/.test(ua) ? "Chrome OS" : /Linux/.test(ua) ? "Linux" : "Other";
  return { browser, os };
}

/**
 * Person properties added automatically to flag requests (LC-FLG-37): the landing URL's campaign (`utm_*` and click ids such
 * as `gclid`, as `$utm_source`...), `$os`, `$browser` and `$device_type`, so a flag can target them with no setup.
 * Turn off with `flagOptions.autoProperties: false`; properties you set yourself win.
 */
export function flagAutoProps(): Record<string, string> {
  if (typeof location === "undefined" || typeof navigator === "undefined") return {};
  const out: Record<string, string> = {};
  const q = new URLSearchParams(location.search);
  for (const k of [...UTM_PARAMS, ...CLICK_IDS]) {
    const v = q.get(k);
    if (v) out[`$${k}`] = v;
  }
  const { browser, os } = uaFamilies();
  out.$browser = browser;
  out.$os = os;
  out.$device_type = String(flagDeviceProps().$device_type ?? "Desktop");
  return out;
}

/** Device properties for `device` filters: screen, viewport, language and a width-based device type. */
export function flagDeviceProps(): Record<string, string | number> {
  if (typeof window === "undefined") return {};
  const w = window.innerWidth;
  return {
    $viewport_width: w,
    $viewport_height: window.innerHeight,
    $screen_width: screen.width,
    $screen_height: screen.height,
    $browser_language: navigator.language,
    // shortcut: width heuristic, not UA parsing; upgrade if device targeting needs exact classes
    $device_type: w < 768 ? "Mobile" : w < 1024 ? "Tablet" : "Desktop",
  };
}

/** Remote config `flag_targeting_sources` (settings.sdk, N-EXP-7): what the page may copy into flag requests. */
export interface FlagTargetingSources {
  cookies?: string[];
  /** Dot paths on `window` (e.g. `app.user.tier`). */
  globals?: string[];
  /** Dot paths looked up in `window.dataLayer` pushes; the latest push that has it wins. */
  data_layer?: string[];
}

const COOKIE_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const DOT_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*){0,5}$/;
const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);
const MAX_SOURCES = 50;
const MAX_VALUE = 200;
type Prim = string | number | boolean;

/** A primitive at `path` under `root`, never reading through DOM nodes (so no form field value can leak). */
function at(root: unknown, path: string): Prim | undefined {
  if (!DOT_PATH.test(path)) return undefined;
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (BLOCKED.has(seg) || cur === null || typeof cur !== "object") return undefined;
    if (typeof Node !== "undefined" && cur instanceof Node) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (typeof cur === "string") return cur.slice(0, MAX_VALUE);
  if ((typeof cur === "number" && Number.isFinite(cur)) || typeof cur === "boolean") return cur;
  return undefined;
}

function cookieJar(): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (typeof document === "undefined" ? "" : document.cookie).split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep the raw value */
    }
    if (!out.has(name)) out.set(name, v.slice(0, MAX_VALUE));
  }
  return out;
}

/**
 * Flag-request person properties from the allow-listed sources: `$cookie/<name>`, `$global/<path>` and
 * `$datalayer/<path>`. Only strings (cut to 200 chars), finite numbers and booleans are copied.
 */
export function flagSourceProps(src: FlagTargetingSources | undefined): Record<string, Prim> {
  const out: Record<string, Prim> = {};
  if (!src || typeof window === "undefined") return out;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_SOURCES) : []);
  const names = list(src.cookies).filter((n) => COOKIE_NAME.test(n));
  if (names.length) {
    const jar = cookieJar();
    for (const n of names) {
      const v = jar.get(n);
      if (v !== undefined) out[`$cookie/${n}`] = v;
    }
  }
  for (const p of list(src.globals)) {
    const v = at(window, p);
    if (v !== undefined) out[`$global/${p}`] = v;
  }
  const dl = (window as { dataLayer?: unknown }).dataLayer;
  if (Array.isArray(dl)) {
    for (const p of list(src.data_layer)) {
      for (let i = dl.length - 1; i >= 0; i--) {
        const v = at(dl[i], p);
        if (v !== undefined) {
          out[`$datalayer/${p}`] = v;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Targeting sources module (N-EXP-7): reads `flag_targeting_sources` from the remote config (in opt_in mode it
 * loads only after consent) and adds the values to flag requests and local evaluation while analytics consent is
 * held. Flags are reloaded once when the config yields any value. Install after `flags`. Inert under
 * `flagOptions.disableRemote` without `localFlags`.
 */
export const flagSources: Module = (host: Host) => {
  // no flag request and no local definitions: nothing to enrich, so the config is not read
  if (host.config.flagOptions?.disableRemote && !host.config.localFlags?.length) return;
  let src: FlagTargetingSources | undefined;
  host.flagPersonProps.push(() => (src && host.core.hasConsent("analytics") ? flagSourceProps(src) : {}));
  void host.loadConfig().then((c) => {
    const s = c?.flag_targeting_sources as FlagTargetingSources | undefined;
    if (!s || typeof s !== "object") return;
    src = s;
    if (Object.keys(flagSourceProps(s)).length) void host.flags?.reload();
  });
};

import type { Storage } from "@lucida/sdk-core";
import { CLICK_IDS } from "../clickids.js";
import { UTM_PARAMS } from "../env.js";

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

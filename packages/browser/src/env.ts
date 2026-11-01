import type { Enrichment } from "@lucida/sdk-core";
import { CLICK_IDS } from "./clickids.js";

export const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

function campaignParams(custom: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const q = new URLSearchParams(location.search);
  for (const k of [...UTM_PARAMS, ...CLICK_IDS, ...custom]) {
    const v = q.get(k);
    if (v) out[`$${k}`] = v;
  }
  return out;
}

/** Signature of the current campaign; a change rotates the session. Click ids are excluded. */
export function campaignKey(): string | undefined {
  const q = new URLSearchParams(location.search);
  const parts = UTM_PARAMS.map((k) => q.get(k) ?? "");
  return parts.some(Boolean) ? parts.join("|") : undefined;
}

function referringDomain(ref: string): string {
  try {
    return ref ? new URL(ref).hostname : "";
  } catch {
    return "";
  }
}

/** The one-time toolbar token must never reach analytics. */
const cleanUrl = (): string => location.href.replace(/([?&])__lc_toolbar=[^&#]*&?/, "$1").replace(/[?&]$/, "");

/** Properties for every event; $pageview also gets campaign params (UTM, click ids, your `customCampaignParams`) and $set_once initial_*. */
export function enrich(event: string, props: Record<string, unknown>, customParams: readonly string[] = []): Enrichment {
  const properties: Record<string, unknown> = {
    $current_url: cleanUrl(),
    $host: location.host,
    $pathname: location.pathname,
    $referrer: document.referrer,
    $screen_width: screen.width,
    $screen_height: screen.height,
    $viewport_width: window.innerWidth,
    $viewport_height: window.innerHeight,
    $browser_language: navigator.language,
    $timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  // iPadOS in desktop mode sends a Mac UA; touch points tell the server it is an iPad.
  if (navigator.maxTouchPoints > 1) properties.$touch_points = navigator.maxTouchPoints;
  if (event !== "$pageview") return { properties };
  const campaign = campaignParams(customParams);
  Object.assign(properties, campaign);
  const url = (props.$current_url as string | undefined) ?? location.href;
  const ref = (props.$referrer as string | undefined) ?? document.referrer;
  const $set_once: Record<string, unknown> = {
    $initial_referrer: ref || "$direct",
    $initial_referring_domain: referringDomain(ref) || "$direct",
    $initial_current_url: url,
  };
  for (const [k, v] of Object.entries(campaign)) $set_once[`$initial_${k.slice(1)}`] = v;
  return { properties, $set_once };
}

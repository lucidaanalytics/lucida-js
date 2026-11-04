/**
 * First-open install attribution for `$app_installed`. Native contract (LucidaReplay.installInfo, a promise method):
 * Android resolves `{platform: "android", referrer?, clickTs?, beginTs?}` (Google Play Install Referrer),
 * iOS resolves `{platform: "ios", token?}` (AdServices `AAAttribution` token). The iOS token is resolved here over `fetch`.
 */
export interface InstallInfo {
  platform: "android" | "ios";
  referrer?: string | null;
  clickTs?: number;
  beginTs?: number;
  token?: string | null;
}
export interface NativeInstallModule {
  installInfo?(): Promise<InstallInfo | null>;
}
export type InstallProps = Record<string, unknown>;

const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid"];
const UTM = ["source", "medium", "campaign", "term", "content"];
const ASA_URL = "https://api-adservices.apple.com/api/v1/";

/** Play Install Referrer string (`utm_source=..&gclid=..`) plus timestamps (seconds) -> `$app_installed` props. */
export function installReferrerProps(raw: string, clickTs?: number, beginTs?: number): InstallProps {
  const q = new Map<string, string>();
  for (const part of raw.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = i < 0 ? part : part.slice(0, i);
    let v = i < 0 ? "" : part.slice(i + 1);
    try {
      v = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      /* keep raw */
    }
    q.set(k, v);
  }
  const out: InstallProps = { $install_store: "google_play", $install_referrer: raw };
  if (clickTs !== undefined) out.$install_referrer_click_ts = clickTs;
  if (beginTs !== undefined) out.$install_begin_ts = beginTs;
  for (const u of UTM) if (q.get(`utm_${u}`)) out[`$utm_${u}`] = q.get(`utm_${u}`);
  for (const c of CLICK_IDS) if (q.get(c)) out[`$${c}`] = q.get(c);
  return out;
}

/** Apple Search Ads attribution response -> `$app_installed` props; null/garbage -> store only. */
export function appStoreInstallProps(json: unknown): InstallProps {
  const out: InstallProps = { $install_store: "app_store" };
  if (!json || typeof json !== "object") return out;
  const o = json as Record<string, unknown>;
  out.$install_adservices_attribution = o.attribution === true;
  if (o.attribution !== true) return out;
  out.$utm_source = "apple_search_ads";
  out.$utm_medium = "cpc";
  const map: [string, string, string?][] = [
    ["campaignId", "$asa_campaign_id", "$utm_campaign"],
    ["keywordId", "$asa_keyword_id", "$utm_term"],
    ["adGroupId", "$asa_ad_group_id", "$utm_content"],
    ["orgId", "$asa_org_id"],
    ["adId", "$asa_ad_id"],
    ["conversionType", "$asa_conversion_type"],
  ];
  for (const [src, asa, utm] of map) {
    const v = o[src];
    if (v === undefined || v === null || v === "") continue;
    out[asa] = String(v);
    if (utm) out[utm] = String(v);
  }
  return out;
}

/** Apple: 404 = record not ready yet; 408, 429 and 5xx are transient. Other statuses (400/401, a bad token) will not change. */
const retryableStatus = (s: number): boolean => s === 404 || s === 408 || s === 429 || s >= 500;

export interface InstallDeps {
  fetch: typeof fetch;
  retryDelayMs?: number;
  attempts?: number;
  timeoutMs?: number;
}

/** Resolves install props from the native module; never rejects (any failure -> `{}` or store only). */
export async function resolveInstallProps(native: () => Promise<InstallInfo | null>, d: InstallDeps): Promise<InstallProps> {
  let fallback: InstallProps = {};
  try {
    const info = await native();
    if (!info) return {};
    fallback = { $install_store: info.platform === "android" ? "google_play" : "app_store" };
    if (info.platform === "android") {
      return info.referrer ? installReferrerProps(info.referrer, info.clickTs, info.beginTs) : { $install_store: "google_play" };
    }
    if (!info.token) return appStoreInstallProps(null);
    const attempts = d.attempts ?? 3;
    for (let i = 0; i < attempts; i++) {
      const ctl = typeof AbortController === "undefined" ? undefined : new AbortController();
      const timer = ctl ? setTimeout(() => ctl.abort(), d.timeoutMs ?? 10_000) : undefined;
      try {
        const r = await d.fetch(ASA_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: info.token, signal: ctl?.signal ?? null });
        if (r.ok) return appStoreInstallProps(await r.json());
        if (!retryableStatus(r.status)) break;
      } catch {
        // network failure or timeout: transient, retried like a 5xx
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (i + 1 < attempts) await new Promise((res) => setTimeout(res, d.retryDelayMs ?? 5000));
    }
    return appStoreInstallProps(null);
  } catch {
    return fallback;
  }
}

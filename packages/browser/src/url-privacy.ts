import type { Props } from "@lucida-analytics/sdk-core";
import { CLICK_IDS } from "./clickids.js";
import { UTM_PARAMS } from "./env.js";
import type { BeforeSend } from "./policy.js";

export interface UrlPrivacy {
  /** Extra query parameter names whose value is replaced with `<masked>` in every URL the SDK sends (added to `SENSITIVE_PARAMS`, which are always masked). */
  maskParams?: string[];
  /** Also mask the UTM and ad click-id parameters (campaign data can identify a person, e.g. e-mail campaign ids). */
  maskCampaignParams?: boolean;
  /** Drop the `#fragment` from URLs (not for hash routers: their route lives there). */
  stripHash?: boolean;
}

export const MASKED = "<masked>";
/** Always masked, case-insensitively, in every URL property and replay meta event (a GET login form must not leak credentials). */
export const SENSITIVE_PARAMS = [
  "password", "passwd", "pwd", "pass", "token", "access_token", "refresh_token", "id_token", "secret",
  "client_secret", "api_key", "apikey", "key", "auth", "authorization", "code", "otp", "email", "ssn",
];
/** Properties that hold a full page URL. */
const URL_KEYS = ["$current_url", "$referrer", "$initial_referrer", "$initial_current_url", "$last_current_url"];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Applies the rules to one URL string. */
export function privatizeUrl(url: string, p: UrlPrivacy): string {
  let out = url;
  const names = [...SENSITIVE_PARAMS, ...(p.maskParams ?? []), ...(p.maskCampaignParams ? [...UTM_PARAMS, ...CLICK_IDS] : [])];
  if (names.length) {
    // a name is matched whole (`?` or `&` before, `=` after) and only in the query part, never in the fragment
    const hash = out.indexOf("#");
    const head = hash < 0 ? out : out.slice(0, hash);
    const tail = hash < 0 ? "" : out.slice(hash);
    out = head.replace(new RegExp(`([?&])(${names.map(escape).join("|")})=[^&]*`, "gi"), `$1$2=${MASKED}`) + tail;
  }
  if (p.stripHash) out = out.replace(/#.*$/, "");
  return out;
}

/** beforeSend hook: rewrites the page-URL properties of the event, `$set` and `$set_once`. */
export function urlPrivacyHook(p: UrlPrivacy): BeforeSend {
  const campaign = new RegExp(`^\\$(initial_|last_)?(${[...UTM_PARAMS, ...CLICK_IDS].map(escape).join("|")})$`);
  const fix = (props: Props): Props => {
    let out: Props | undefined;
    if (p.maskCampaignParams) {
      for (const [k, v] of Object.entries(props)) {
        if (typeof v === "string" && campaign.test(k)) (out ??= { ...props })[k] = MASKED;
        else if (k === "$click_ids" && v && typeof v === "object") (out ??= { ...props })[k] = Object.fromEntries(Object.keys(v).map((n) => [n, MASKED]));
      }
    }
    for (const k of URL_KEYS) {
      const v = (out ?? props)[k];
      if (typeof v !== "string") continue;
      const next = privatizeUrl(v, p);
      if (next !== v) (out ??= { ...props })[k] = next;
    }
    return out ?? props;
  };
  return (e) => ({
    ...e,
    properties: fix(e.properties),
    ...(e.$set ? { $set: fix(e.$set) } : {}),
    ...(e.$set_once ? { $set_once: fix(e.$set_once) } : {}),
  });
}

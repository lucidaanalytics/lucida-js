/**
 * URL-scoped replay privacy rules (P-M16): on pages matching a rule's `url` pattern the recorder
 * masks all text and/or extra selectors on top of the site-wide policy. Rules only tighten.
 * The recorder restarts (new full snapshot) when the page's combined masking changes.
 */
import { policyMatches } from "./config.js";

export interface UrlPrivacyRule {
  /** Substring with `*` wildcards, or `re:` + regular expression (case-insensitive), like the URL blocklist. */
  url: string;
  mask_all_text?: boolean;
  mask_selectors?: string[];
  block_selectors?: string[];
}

export interface PagePrivacy {
  maskAllText: boolean;
  mask: string[];
  block: string[];
  /** Equal keys mean equal masking (no restart needed). */
  key: string;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);

/** Well-formed rules only (remote config is untrusted input). */
export function urlRules(v: unknown): UrlPrivacyRule[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as { url?: unknown }).url === "string")
    .map((r) => ({
      url: r.url as string,
      mask_all_text: r.mask_all_text === true,
      mask_selectors: strs(r.mask_selectors),
      block_selectors: strs(r.block_selectors),
    }));
}

/** The masking every rule matching `url` adds. */
export function pagePrivacy(rules: UrlPrivacyRule[], url: string): PagePrivacy {
  const hit = rules.filter((r) => policyMatches([r.url], url));
  const maskAllText = hit.some((r) => r.mask_all_text === true);
  const mask = [...new Set(hit.flatMap((r) => r.mask_selectors ?? []))];
  const block = [...new Set(hit.flatMap((r) => r.block_selectors ?? []))];
  return { maskAllText, mask, block, key: JSON.stringify([maskAllText, mask, block]) };
}

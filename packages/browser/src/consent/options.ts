import type { ConsentCategory, ConsentState } from "@lucida-analytics/sdk-core";

export type BannerPosition = "bottom" | "top" | "center" | "bottom-left" | "bottom-right";

export interface BannerTexts {
  title: string;
  body: string;
  acceptAll: string;
  rejectAll: string;
  /** Saves the per-category choices (shown when more than one category is offered). */
  save: string;
  /** Label per category checkbox. */
  categories: Record<ConsentCategory, string>;
}

export interface BannerOptions {
  /** Categories the visitor can choose. Default: analytics, replay, marketing. */
  categories?: ConsentCategory[];
  texts?: Partial<Omit<BannerTexts, "categories">> & { categories?: Partial<BannerTexts["categories"]> };
  position?: BannerPosition;
  /** Policy/text version written to the `$consent_updated` record. Default `consent.policyVersion` or "1". */
  version?: string;
  /**
   * Fill copy, categories and position from the project's `consent_banner` (settings.sdk, served by `GET /v1/config`).
   * Options given here win. This is one request carrying only the public key, made before consent; off by default.
   */
  remote?: boolean;
}

/** Optional first-party banner (lazy chunk). */
export interface ConsentUi {
  /** Resolves with the stored decision, or null when dismissed with Escape (nothing is stored). */
  showBanner(opts?: BannerOptions): Promise<ConsentState | null>;
  hideBanner(): void;
}

export type ConsentSource = "banner" | "tcf" | "gcm" | "onetrust" | "cookiebot" | "osano" | "usercentrics" | "api";

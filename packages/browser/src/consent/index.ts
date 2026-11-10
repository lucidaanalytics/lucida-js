export {
  tcfConsent, gcmConsent, oneTrustConsent, cookiebotConsent, cookieMunchConsent, osanoConsent, usercentricsConsent, usercentricsBridge,
  tcfToConsent, gcmToConsent, oneTrustToConsent, cookiebotToConsent, cookieMunchToConsent, osanoToConsent, usercentricsToConsent,
} from "./cmp.js";
export type { UcService } from "./cmp.js";
import { cookieMunchConsent as followCookieMunch } from "./cmp.js";
import { consentBanner } from "./ui.js";
import type { Module } from "../types.js";
export { consentBanner };
export { applyConsent, CONSENT_EVENT } from "./record.js";
export type { BannerOptions, BannerPosition, BannerTexts, ConsentSource, ConsentUi } from "./options.js";

/**
 * What the classic script's `modules: ["consent"]` loads: the banner API (`client.consent.showBanner()`) and the
 * Cookie Munch follower, so a page behind Cookie Munch needs no wiring (a no-op when `window.CookieMunch` is absent).
 */
export const consentModule: Module = (host) => {
  consentBanner(host);
  return followCookieMunch(host);
};

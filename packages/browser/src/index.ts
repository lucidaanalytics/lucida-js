import { createClient } from "./client.js";
import { autocapture } from "./autocapture/index.js";
import { flags } from "./flags/index.js";
import { flagSources } from "./flags/request-props.js";
import { correlate } from "./watchtower/correlate.js";
import { hostHeaders } from "./host-headers.js";
import { crossDomain } from "./linker.js";
import type { BrowserConfig, Client, Module } from "./types.js";

/** Full client: core + autocapture + flags + Watchtower correlation (inert unless watchtower.correlate).
 * Opt-in modules (replay, heatmaps, forms, toolbar, inspector, consent adapters) have their own entry points. Import "@lucida-analytics/browser/core" for the minimal build. */
export function init(apiKey: string, config: BrowserConfig = {}, extra: Module[] = []): Client {
  return createClient(apiKey, config, [autocapture, flags, flagSources, correlate, hostHeaders, crossDomain, ...extra]);
}

export { createClient, DEFAULT_HOST, LIB_VERSION } from "./client.js";
export { assetUrl, isExtensionPage, loadModules, rewriteUrl } from "./delivery.js";
export { blocksInlineStyle, captureCspViolations, styleTag } from "./csp.js";
export type { CspCaptureOptions } from "./csp.js";
export { autocapture, tag404 } from "./autocapture/index.js";
export { crossDomain } from "./linker.js";
export { flags } from "./flags/index.js";
export { hostHeaders } from "./host-headers.js";
export { sampleHook, denylistHook } from "./policy.js";
export { urlPrivacyHook, privatizeUrl } from "./url-privacy.js";
export type { UrlPrivacy } from "./url-privacy.js";
export type { BeforeSend, PersonProfiles } from "./policy.js";
export { earlyAccess } from "./early-access/index.js";
export type { DevtoolsHook, DevtoolsTarget } from "./devtools-hook.js";
export { flagSources, flagSourceProps } from "./flags/request-props.js";
export type { FlagTargetingSources } from "./flags/request-props.js";
export { recommendations, placementFlag, RECS_PAYLOAD_KEY } from "./recs/index.js";
export type { RecommendationItem, RecommendationOptions, Recommendations, RecsService } from "./recs/index.js";
export type {
  AgentAnalytics, BrowserConfig, AutocaptureConfig, StorageConfig, DeliveryConfig, LazyModuleName, CaptureOptions, BootstrapConfig, FlagOptions, FrustrationConfig, Client, Host, Module, Persistence, FlagValue, FlagsService, ReplayControl, Guide, GuideKind, GuideStep, GuideAutomation, GuideRule, GuideTokens, TargetConditions, GuideButton, PropFilter, GuidesService, RemoteConfig,
} from "./types.js";
export type { AgentConversation, AgentConversationOptions, AgentFeedback, AgentOutcome, AgentRole, EarlyAccessFeature, EarlyAccessService, FlagResult, Intervention } from "@lucida-analytics/sdk-core";

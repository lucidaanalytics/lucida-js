import { createClient } from "./client.js";
import { autocapture } from "./autocapture/index.js";
import { flags } from "./flags/index.js";
import { correlate } from "./watchtower/correlate.js";
import { hostHeaders } from "./host-headers.js";
import { crossDomain } from "./linker.js";
import type { BrowserConfig, Client, Module } from "./types.js";

/** Full client: core + autocapture + flags + Watchtower correlation (inert unless watchtower.correlate).
 * Opt-in modules (replay, heatmaps, forms, toolbar, inspector, consent adapters) have their own entry points. Import "@lucida/browser/core" for the minimal build. */
export function init(apiKey: string, config: BrowserConfig = {}, extra: Module[] = []): Client {
  return createClient(apiKey, config, [autocapture, flags, correlate, hostHeaders, crossDomain, ...extra]);
}

export { createClient, DEFAULT_HOST, LIB_VERSION } from "./client.js";
export { assetUrl, isExtensionPage, loadModules, rewriteUrl } from "./delivery.js";
export { blocksInlineStyle, styleTag } from "./csp.js";
export { autocapture, tag404 } from "./autocapture/index.js";
export { crossDomain } from "./linker.js";
export { flags } from "./flags/index.js";
export { hostHeaders } from "./host-headers.js";
export { sampleHook, denylistHook } from "./policy.js";
export type { BeforeSend, PersonProfiles } from "./policy.js";
export { earlyAccess } from "./early-access/index.js";
export type {
  BrowserConfig, AutocaptureConfig, StorageConfig, DeliveryConfig, LazyModuleName, CaptureOptions, BootstrapConfig, FlagOptions, FrustrationConfig, Client, Host, Module, Persistence, FlagValue, FlagsService, ReplayControl, Guide, GuideKind, GuideStep, TargetConditions, GuideButton, PropFilter, GuidesService, RemoteConfig,
} from "./types.js";
export type { EarlyAccessFeature, EarlyAccessService, FlagResult } from "@lucida/sdk-core";

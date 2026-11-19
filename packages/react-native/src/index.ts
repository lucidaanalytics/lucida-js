export { createClient, LIB, LIB_VERSION } from "./client.js";
export { asyncStorageAdapter, fetchTransport, splitBatches, withTimeout, encryptedStorage, appLifecycle, memoryStorage, PERSISTED_KEYS } from "./adapters.js";
export type { AsyncStorageLike, AppStateLike, AppStateStatus, QueueCipher } from "./adapters.js";
export { nativeQueueCipher } from "./native-cipher.js";
export type { NativeCipherModule } from "./native-cipher.js";
export { appStoreInstallProps, installReferrerProps, resolveInstallProps } from "./install.js";
export type { InstallInfo, NativeInstallModule } from "./install.js";
export { screenTracker } from "./navigation.js";
export { expoRouterScreens } from "./expo-router-screens.js";
export type { NavigationRefLike } from "./navigation.js";
export { sampleHook, runHooks, PersonMode } from "./policy.js";
export { createAutocapture, chainFromFiber, touchHandler } from "./autocapture.js";
export type { Autocapture, AutocaptureConfig, FiberLike, RageTapConfig, TapElement, TouchEventLike } from "./autocapture.js";
export { tracedFetch, tracingHeaders, withBaggage } from "./host-headers.js";
export { createReplaySpool } from "./replay-spool.js";
export type { SpoolEntry } from "./replay-spool.js";
export { createReplay, screenAllowed, effectiveSampleRate, effectiveMinDurationMs, exposureKeyOf } from "./replay.js";
export { screenMasked, compilePatterns, maskPatterns, maskSnapshotText } from "./replay-masking.js";
export { swipeDirection, deadSwipeDecision, DEAD_SWIPE_MIN_DISTANCE } from "./dead-swipe.js";
export type { SwipeDirection, DeadSwipeInput } from "./dead-swipe.js";
export { createSensitiveCapture, encryptSensitive, truncateUtf8, SENSITIVE_MAX_PLAIN_BYTES } from "./sensitive.js";
export type { ExposureKey, NativeSensitiveModule, SensitiveCapture } from "./sensitive.js";
export type { NativeReplayModule, ReplayConfig, ReplayService } from "./replay.js";
export { applyConsent } from "./consent-log.js";
export { createGuides, guideAnchor, guideButtons, matches as matchGuideScreen, screenExcluded } from "./guides.js";
export type { GuideAnchorSpec, GuideButton, GuideStep, GuideView, GuidesDeps, GuidesService, MobileGuide } from "./guides.js";
export { bubbleOrigin, guideTokens } from "./guide-theme.js";
export type { GuideTokens } from "./guide-theme.js";
export { LucidaProvider } from "./provider.js";
export type { LucidaProviderProps, Flags } from "./provider.js";
export {
  useLucida, useCapture, useScreen, useFeatureFlag, useFeatureFlagVariant, useFeatureFlagPayload,
  useActiveFeatureFlags, useReplay, FeatureGate,
} from "./hooks.js";
export type { FeatureGateProps } from "./hooks.js";
export type { NativeClient, NativeConfig, FlagValue, ReplayControl, Bootstrap, FlagOptions, CaptureOptions, FlagResult, Intervention } from "./types.js";

export { createClient, LIB, LIB_VERSION } from "./client.js";
export { asyncStorageAdapter, fetchTransport, splitBatches, withTimeout, encryptedStorage, appLifecycle, memoryStorage, PERSISTED_KEYS } from "./adapters.js";
export type { AsyncStorageLike, AppStateLike, AppStateStatus, QueueCipher } from "./adapters.js";
export { nativeQueueCipher } from "./native-cipher.js";
export type { NativeCipherModule } from "./native-cipher.js";
export { screenTracker } from "./navigation.js";
export type { NavigationRefLike } from "./navigation.js";
export { sampleHook, runHooks, PersonMode } from "./policy.js";
export { createAutocapture, chainFromFiber, touchHandler } from "./autocapture.js";
export type { Autocapture, AutocaptureConfig, FiberLike, RageTapConfig, TapElement, TouchEventLike } from "./autocapture.js";
export { tracedFetch, tracingHeaders, withBaggage } from "./host-headers.js";
export { createReplay, screenAllowed, effectiveSampleRate, effectiveMinDurationMs } from "./replay.js";
export type { NativeReplayModule, ReplayConfig, ReplayService } from "./replay.js";
export { createGuides, guideButtons, matches as matchGuideScreen } from "./guides.js";
export type { GuideButton, GuideStep, GuideView, GuidesDeps, GuidesService, MobileGuide } from "./guides.js";
export { LucidaGuides } from "./guides-view.js";
export { LucidaMask, LucidaUnmask, LucidaTouchCapture, replayMarker, REPLAY_MARKERS } from "./mask.js";
export { LucidaProvider } from "./provider.js";
export type { LucidaProviderProps, Flags } from "./provider.js";
export {
  useLucida, useCapture, useScreen, useFeatureFlag, useFeatureFlagVariant, useFeatureFlagPayload,
  useActiveFeatureFlags, useReplay, FeatureGate,
} from "./hooks.js";
export type { FeatureGateProps } from "./hooks.js";
export type { NativeClient, NativeConfig, FlagValue, ReplayControl, Bootstrap, FlagOptions, CaptureOptions, FlagResult } from "./types.js";

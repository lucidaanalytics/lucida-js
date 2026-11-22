// @lucida-analytics/expo: the React Native SDK with Expo wiring done (storage, app state, version, platform, native module when present).
import { createElement, useState } from "react";
import { AppState, NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import * as Application from "expo-application";
import { createClient as createNativeClient, LucidaProvider as NativeProvider } from "@lucida-analytics/react-native";
import type { LucidaProviderProps as NativeProps, NativeClient } from "@lucida-analytics/react-native";
import { expoFileSystemStorage } from "@lucida-analytics/react-native/storage/expo-file-system";
import { expoConfig } from "./defaults.js";
import type { ExpoDeps, ExpoOptions, LucidaNative } from "./defaults.js";

export * from "@lucida-analytics/react-native";
export { expoConfig } from "./defaults.js";
export type { ExpoDeps, ExpoOptions } from "./defaults.js";

function deps(): ExpoDeps {
  return {
    storage: () => expoFileSystemStorage(),
    appState: AppState as unknown as ExpoDeps["appState"],
    platform: Platform,
    constants: Constants as unknown as ExpoDeps["constants"],
    application: Application,
    native: NativeModules.LucidaReplay as LucidaNative | undefined,
  };
}

/** Same as the React Native `createClient`, with the Expo defaults filled in; any option you pass wins. */
export function createClient(apiKey: string, options?: ExpoOptions): Promise<NativeClient> {
  return createNativeClient(apiKey, expoConfig(deps(), options));
}

export type LucidaProviderProps = Omit<NativeProps, "options"> & { options?: ExpoOptions };

export function LucidaProvider({ options, ...props }: LucidaProviderProps) {
  // options are read once, like the React Native provider: storage and warnings are built a single time.
  const [cfg] = useState(() => (props.client ? undefined : expoConfig(deps(), options)));
  return createElement(NativeProvider, cfg ? { ...props, options: cfg } : props);
}

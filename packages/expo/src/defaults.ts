// Pure: builds the React Native SDK config an Expo app would otherwise wire by hand. Modules are injected so tests need no Expo.
import type { AsyncStorageLike, AppStateLike, NativeConfig, NativeReplayModule } from "@lucida-analytics/react-native";

export type LucidaNative = NativeReplayModule & {
  installInfo?(): Promise<import("@lucida-analytics/react-native").InstallInfo | null>;
};

export interface ExpoDeps {
  storage: () => AsyncStorageLike;
  appState: AppStateLike;
  platform: { OS: string; Version: string | number };
  /** expo-constants: app.json `version`, and whether this runs inside Expo Go (`storeClient`). */
  constants: { expoConfig?: { version?: string } | null; executionEnvironment?: string };
  /** expo-application; inside Expo Go these are Expo Go's own, so they are ignored there. */
  application: { nativeApplicationVersion: string | null; nativeBuildVersion: string | null };
  /** NativeModules.LucidaReplay: present in a development or release build, absent in Expo Go. */
  native?: LucidaNative | undefined;
  warn?: (msg: string) => void;
}

/** Expo-specific options on top of the React Native SDK's: `replay` needs no `module`, it is found. */
export type ExpoOptions = Omit<NativeConfig, "replay"> & { replay?: Omit<NonNullable<NativeConfig["replay"]>, "module"> };

export function expoConfig(deps: ExpoDeps, opts: ExpoOptions = {}): NativeConfig {
  const expoGo = deps.constants.executionEnvironment === "storeClient";
  const { replay, ...rest } = opts;
  const native = expoGo ? undefined : deps.native;
  const version = deps.constants.expoConfig?.version ?? (expoGo ? null : deps.application.nativeApplicationVersion);
  const cfg: NativeConfig = {
    appState: deps.appState,
    platform: deps.platform.OS,
    osVersion: String(deps.platform.Version),
    ...(version ? { appVersion: version } : {}),
    ...(expoGo || !deps.application.nativeBuildVersion ? {} : { appBuild: deps.application.nativeBuildVersion }),
    ...(native?.installInfo ? { installInfo: () => native.installInfo!() } : {}),
    ...rest,
  };
  if (!cfg.asyncStorage) cfg.asyncStorage = deps.storage();
  if (replay?.enabled) {
    if (native) cfg.replay = { ...replay, module: native };
    else (deps.warn ?? console.warn)("[lucida] session replay needs a development build (npx expo run:ios / run:android); it is off in Expo Go. Analytics and flags work.");
  }
  return cfg;
}

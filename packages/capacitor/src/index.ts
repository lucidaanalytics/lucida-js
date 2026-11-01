export { createClient, LIB, LIB_VERSION } from "./client.js";
export type { CapacitorClient, CapacitorConfig } from "./client.js";
export {
  appLifecycle, capacitorBridge, fetchTransport, memoryStorage, preferencesStorage, stripReserved, PERSISTED_KEYS,
} from "./adapters.js";
export type { AppPluginLike, CapacitorBridgeLike, ListenerHandleLike, PreferencesLike } from "./adapters.js";
export type { FlagsService } from "./flags.js";

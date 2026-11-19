// Subpath `@lucida-analytics/react-native/storage/expo-secure-store` (optional peer: expo-secure-store).
import * as SS from "expo-secure-store";
import type { AsyncStorageLike } from "../adapters.js";
import { PERSISTED_KEYS } from "../adapters.js";

/**
 * SecureStore keeps small values only (about 2 KB on iOS) and cannot list keys, so the offline queue (`lc_offline`)
 * and replay spool (`lc_replay*`) are NOT kept: use it for identity/consent, or pair it with encryptedStorage elsewhere.
 * Keys must match [A-Za-z0-9._-]; the SDK's keys do.
 */
export function expoSecureStoreStorage(): AsyncStorageLike {
  const skip = (k: string): boolean => k === "lc_offline" || k.startsWith("lc_replay");
  return {
    multiGet: (keys) => Promise.all(keys.map(async (k) => [k, skip(k) ? null : await SS.getItemAsync(k).catch(() => null)] as const)),
    setItem: async (k, v) => void (skip(k) || (await SS.setItemAsync(k, v))),
    removeItem: async (k) => void (skip(k) || (await SS.deleteItemAsync(k))),
    getAllKeys: async () => [...PERSISTED_KEYS],
  };
}

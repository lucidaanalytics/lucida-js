import type { AsyncStorageLike } from "../adapters.js";

/** The slice of react-native-mmkv's MMKV instance used (synchronous). */
export interface MmkvLike {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  getAllKeys(): string[];
}

export function mmkvStorage(m: MmkvLike): AsyncStorageLike {
  return {
    multiGet: async (keys) => keys.map((k) => [k, m.getString(k) ?? null] as const),
    setItem: async (k, v) => m.set(k, v),
    removeItem: async (k) => m.delete(k),
    getAllKeys: async () => m.getAllKeys(),
  };
}

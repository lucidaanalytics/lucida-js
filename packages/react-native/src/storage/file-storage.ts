import type { AsyncStorageLike } from "../adapters.js";

/** The slice of expo-file-system (legacy API) used. */
export interface FileIo {
  readAsStringAsync(uri: string): Promise<string>;
  writeAsStringAsync(uri: string, contents: string): Promise<void>;
  deleteAsync(uri: string, opts?: { idempotent?: boolean }): Promise<void>;
  makeDirectoryAsync(uri: string, opts?: { intermediates?: boolean }): Promise<void>;
  readDirectoryAsync(uri: string): Promise<string[]>;
}

const enc = (k: string): string => encodeURIComponent(k);

export function fileStorage(fs: FileIo, dir: string): AsyncStorageLike {
  const ready = fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const read = (k: string): Promise<string | null> => ready.then(() => fs.readAsStringAsync(dir + enc(k))).catch(() => null);
  return {
    multiGet: (keys) => Promise.all(keys.map(async (k) => [k, await read(k)] as const)),
    setItem: async (k, v) => (await ready, fs.writeAsStringAsync(dir + enc(k), v)),
    removeItem: async (k) => (await ready, fs.deleteAsync(dir + enc(k), { idempotent: true })),
    getAllKeys: async () => (await ready, (await fs.readDirectoryAsync(dir)).map(decodeURIComponent)),
  };
}

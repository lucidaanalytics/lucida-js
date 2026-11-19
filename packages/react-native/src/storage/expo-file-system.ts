// Subpath `@lucida-analytics/react-native/storage/expo-file-system` (optional peer: expo-file-system).
import * as FS from "expo-file-system";
import type { AsyncStorageLike } from "../adapters.js";
import { fileStorage } from "./file-storage.js";
import type { FileIo } from "./file-storage.js";

/** One file per key under `dir` (default: the app document directory). */
export function expoFileSystemStorage(opts: { dir?: string; fs?: FileIo } = {}): AsyncStorageLike {
  const fs = opts.fs ?? (FS as unknown as FileIo);
  return fileStorage(fs, opts.dir ?? `${(FS as unknown as { documentDirectory: string }).documentDirectory}lucida/`);
}

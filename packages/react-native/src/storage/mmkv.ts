// Subpath `@lucida-analytics/react-native/storage/mmkv` (optional peer: react-native-mmkv).
import type { AsyncStorageLike } from "../adapters.js";
import { mmkvStorage } from "./mmkv-storage.js";
import type { MmkvLike } from "./mmkv-storage.js";
import { MMKV } from "react-native-mmkv";

/** Pass your own `MMKV` instance, or get one with id `lucida`. */
export function mmkvAsyncStorage(instance?: MmkvLike): AsyncStorageLike {
  return mmkvStorage(instance ?? (new (MMKV as unknown as new (o: { id: string }) => MmkvLike)({ id: "lucida" })));
}

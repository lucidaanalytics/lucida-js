import type { QueueCipher } from "./adapters.js";

/**
 * Native contract (ios/LucidaReplay.swift -> KeychainQueueCipher, android/.../LucidaReplayModule.kt -> KeystoreQueueCipher):
 * two blocking synchronous methods (`RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD` / `isBlockingSynchronousMethod = true`), because
 * the core's Storage port is synchronous. AES-256-GCM with a non-exportable key held by the platform (iOS Keychain, Android
 * Keystore), generated on first use. Ciphertext is base64 of nonce + ciphertext + tag, the same format as the native SDKs.
 * Blocking synchronous methods need JSI, so they are unavailable while debugging through the remote JS debugger.
 */
export interface NativeCipherModule {
  encryptQueue(plain: string): string;
  /** null or "" when the value cannot be decrypted (key lost or rotated, corrupt data). */
  decryptQueue(cipher: string): string | null | undefined;
}

/**
 * `queueCipher` backed by the platform key store: `createClient({ queueCipher: nativeQueueCipher(NativeModules.LucidaReplay), ... })`.
 * The module is injected so tests and non-native hosts need no React Native. Fails closed: a native error on encrypt stores an
 * empty value (read back as an empty queue), never the plaintext; a native error on decrypt reads as an empty queue.
 */
export function nativeQueueCipher(module: NativeCipherModule | null | undefined): QueueCipher {
  if (!module || typeof module.encryptQueue !== "function" || typeof module.decryptQueue !== "function") {
    throw new Error("nativeQueueCipher: the native LucidaReplay module has no encryptQueue/decryptQueue (rebuild the app, and note blocking sync methods do not work under the remote JS debugger)");
  }
  return {
    encrypt(plain) {
      try {
        const out = module.encryptQueue(plain);
        return typeof out === "string" ? out : "";
      } catch {
        return "";
      }
    },
    decrypt(cipher) {
      if (cipher === "") return null;
      try {
        const out = module.decryptQueue(cipher);
        return typeof out === "string" && out !== "" ? out : null;
      } catch {
        return null;
      }
    },
  };
}

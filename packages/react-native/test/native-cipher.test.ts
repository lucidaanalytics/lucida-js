import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptedStorage, nativeQueueCipher } from "../src/index.js";
import type { NativeCipherModule } from "../src/index.js";

/** A stand-in for the Keychain / Keystore module: real AES-256-GCM, base64(nonce + ciphertext + tag), like the native adapters. */
function fakeNative(key: Buffer = randomBytes(32)): NativeCipherModule & { calls: string[] } {
  return {
    calls: [] as string[],
    encryptQueue(plain) {
      this.calls.push("encrypt");
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64");
    },
    decryptQueue(value) {
      this.calls.push("decrypt");
      try {
        const all = Buffer.from(value, "base64");
        const d = createDecipheriv("aes-256-gcm", key, all.subarray(0, 12));
        d.setAuthTag(all.subarray(all.length - 16));
        return Buffer.concat([d.update(all.subarray(12, all.length - 16)), d.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  } as NativeCipherModule & { calls: string[] };
}

function memoryStore() {
  const mem = new Map<string, string>();
  return { mem, store: { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v), remove: (k: string) => void mem.delete(k) } };
}

describe("nativeQueueCipher", () => {
  it("round-trips through the native module and never stores plaintext", () => {
    const native = fakeNative();
    const cipher = nativeQueueCipher(native);
    const { mem, store } = memoryStore();
    const s = encryptedStorage(store, cipher, ["lc_offline"]);
    const queue = JSON.stringify([{ event: "secret-purchase", properties: { email: "a@b.c" } }]);
    s.set("lc_offline", queue);
    s.set("lc_session", "plain");
    const raw = mem.get("lc_offline")!;
    expect(raw).not.toContain("secret-purchase");
    expect(raw.startsWith("[")).toBe(false);
    expect(Buffer.from(raw, "base64").length).toBe(12 + Buffer.byteLength(queue) + 16); // nonce + ciphertext + tag
    expect(mem.get("lc_session")).toBe("plain");
    expect(s.get("lc_offline")).toBe(queue);
    expect(native.calls).toEqual(["encrypt", "decrypt"]);
  });

  it("reads as an empty queue when the key was lost, the data is corrupt, or the native side fails", () => {
    const writer = nativeQueueCipher(fakeNative());
    const stored = writer.encrypt("queue");
    expect(nativeQueueCipher(fakeNative()).decrypt(stored)).toBeNull(); // different key
    expect(writer.decrypt("garbage")).toBeNull();
    expect(writer.decrypt("")).toBeNull();
    const throwing: NativeCipherModule = {
      encryptQueue: vi.fn(() => { throw new Error("keychain locked"); }),
      decryptQueue: vi.fn(() => { throw new Error("keychain locked"); }),
    };
    const c = nativeQueueCipher(throwing);
    expect(c.encrypt("secret")).toBe(""); // fails closed: never the plaintext
    expect(c.decrypt("anything")).toBeNull();
    expect(nativeQueueCipher({ encryptQueue: () => "x", decryptQueue: () => undefined }).decrypt("x")).toBeNull();
  });

  it("explains a missing native module", () => {
    expect(() => nativeQueueCipher(undefined)).toThrow(/encryptQueue\/decryptQueue/);
    expect(() => nativeQueueCipher({ encryptQueue: () => "" } as unknown as NativeCipherModule)).toThrow(/encryptQueue\/decryptQueue/);
  });
});

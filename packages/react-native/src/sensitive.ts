import { sha256Hex } from "@lucida/sdk-core";

/**
 * P-L12 controlled exposure. The RSA-OAEP-SHA256 encryption runs natively (`encryptSensitive` on the LucidaReplay module,
 * a blocking synchronous method: iOS SecKey, Android Cipher with MGF1-SHA256), so only an audited reveal on the server can
 * read the value. Identical values are sent once per session (an in-memory SHA-256 set, never persisted or sent).
 */
export interface NativeSensitiveModule {
  /** Standard base64 of the ciphertext of the UTF-8 of `plain`, or "" on failure. */
  encryptSensitive(pkcs1: string, n: string, e: string, plain: string): string;
}

export interface ExposureKey {
  kid: string;
  /** base64url (no padding) big-endian modulus */
  n: string;
  /** base64url (no padding) exponent */
  e: string;
  /** standard base64 of the PKCS#1 RSAPublicKey DER */
  pkcs1: string;
}

export const SENSITIVE_MAX_PLAIN_BYTES = 190;

const utf8Len = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** [value] cut so its UTF-8 is at most [max] bytes, on a code point boundary; `truncated` when cut. */
export function truncateUtf8(value: string, max = SENSITIVE_MAX_PLAIN_BYTES): { text: string; truncated: boolean } {
  let bytes = 0;
  let text = "";
  for (const ch of value) {
    const n = utf8Len(ch.codePointAt(0)!);
    if (bytes + n > max) return { text, truncated: true };
    bytes += n;
    text += ch;
  }
  return { text, truncated: false };
}

/** Native encryption, failing closed: null when the module is missing, throws or returns "". */
export function encryptSensitive(module: Partial<NativeSensitiveModule> | undefined, key: ExposureKey, plain: string): string | null {
  const fn = module?.encryptSensitive;
  if (typeof fn !== "function") return null;
  try {
    const out = fn.call(module, key.pkcs1, key.n, key.e, plain);
    return typeof out === "string" && out !== "" ? out : null;
  } catch {
    return null;
  }
}

export interface SensitiveCapture {
  /** `$sensitive_capture` properties, or null when this value was already sent this session or encryption failed. */
  properties(field: string, value: string, screen: string, key: ExposureKey, sessionId: string): Record<string, unknown> | null;
}

export function createSensitiveCapture(module: Partial<NativeSensitiveModule> | undefined): SensitiveCapture {
  const seen = new Set<string>();
  let session: string | undefined;
  return {
    properties(field, value, screen, key, sessionId) {
      if (session !== sessionId) {
        seen.clear();
        session = sessionId;
      }
      const digest = sha256Hex(`${field}\u0000${value}`);
      if (seen.has(digest)) return null;
      const t = truncateUtf8(value);
      const ct = encryptSensitive(module, key, t.text);
      if (ct === null) return null;
      seen.add(digest);
      return {
        $exposure_field: field,
        $exposure_kid: key.kid,
        $exposure_ciphertext: ct,
        $screen_name: screen,
        ...(t.truncated ? { $exposure_truncated: true } : {}),
      };
    },
  };
}

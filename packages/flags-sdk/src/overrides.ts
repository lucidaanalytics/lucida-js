/** Cookie the Flags Explorer writes its per-visitor overrides to. */
export const OVERRIDES_COOKIE = "vercel-flag-overrides";

const b64 = (s: string): Uint8Array => {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/**
 * Reads the Flags Explorer overrides: the cookie is a compact JWE (alg `dir`, enc `A256GCM`) sealed with
 * FLAGS_SECRET (a base64url 256-bit key), whose payload holds the flag values under `o`. Anything that does
 * not verify (wrong secret, tampered, expired, malformed) yields no overrides: a visitor can never override a
 * flag with a cookie the secret holder did not write. Web Crypto only, so it runs on the edge.
 */
export async function readOverrides(cookie: string | undefined, secret: string | undefined): Promise<Record<string, unknown>> {
  if (!cookie || !secret) return {};
  try {
    const [header, key, iv, data, tag] = cookie.split(".");
    if (!header || key !== "" || !iv || !data || !tag) return {};
    const h = JSON.parse(new TextDecoder().decode(b64(header))) as { alg?: string; enc?: string };
    if (h.alg !== "dir" || h.enc !== "A256GCM") return {};
    const k = await crypto.subtle.importKey("raw", b64(secret) as BufferSource, "AES-GCM", false, ["decrypt"]);
    const sealed = new Uint8Array([...b64(data), ...b64(tag)]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(iv) as BufferSource, additionalData: new TextEncoder().encode(header) as BufferSource }, k, sealed as BufferSource);
    const payload = JSON.parse(new TextDecoder().decode(plain)) as { o?: Record<string, unknown>; exp?: number };
    if (payload.exp && payload.exp * 1000 < Date.now()) return {};
    const o = payload.o ?? {};
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

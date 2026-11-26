/** Cookie the browser SDK writes: `lc_consent=granted|denied` (the anonymous id is a separate `lc_distinct_id` cookie). */
export const CONSENT_COOKIE = "lc_consent";

/** Read the consent decision from a `Cookie` request header. undefined when no decision was made. */
export function consentFromCookie(header: string | null | undefined, name = CONSENT_COOKIE): "granted" | "denied" | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim().split(".")[0];
      return v === "granted" || v === "denied" ? v : undefined;
    }
  }
  return undefined;
}

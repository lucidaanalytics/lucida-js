import { LIB_VERSION } from "./client.js";
import { CONSENT_COOKIE, consentFromCookie } from "./consent.js";
import { envKey } from "./env.js";

export interface CaptureImmediateInput {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  uuid?: string;
  timestamp?: Date | string;
}
export interface CaptureImmediateOptions {
  apiKey?: string;
  host?: string;
  /**
   * The request's `Cookie` header or a cookie store (Next `cookies()`): reads `lc_consent` (`granted` | `denied`, a stable
   * contract). Granted stamps `$consent_analytics: "granted"` on the event and its person (`$set`); denied sends nothing
   * (`{ ok: false, error: "consent denied" }`); no decision sends as before.
   */
  consentFromCookies?: string | null | { get(name: string): { value: string } | string | undefined };
}
export interface CaptureImmediateResult {
  ok: boolean;
  status?: number;
  error?: string;
}

const TIMEOUT_MS = 5000;

/**
 * Send one event now with a single POST: no client, no queue, no retries, no timers left behind. Never throws.
 * Key from `opts.apiKey`, `LUCIDA_SECRET_KEY` or `LUCIDA_KEY`; host from `opts.host`, `LUCIDA_HOST`, else Lucida cloud.
 */
export async function captureImmediate(i: CaptureImmediateInput, opts: CaptureImmediateOptions = {}): Promise<CaptureImmediateResult> {
  const apiKey = opts.apiKey ?? envKey();
  if (!apiKey) return { ok: false, error: "no api key (opts.apiKey or LUCIDA_SECRET_KEY)" };
  const jar = opts.consentFromCookies;
  let consent: "granted" | "denied" | undefined;
  if (typeof jar === "string" || jar === null) consent = consentFromCookie(jar);
  else if (jar) {
    const c = jar.get(CONSENT_COOKIE);
    consent = consentFromCookie(`${CONSENT_COOKIE}=${typeof c === "string" ? c : (c?.value ?? "")}`);
  }
  if (consent === "denied") return { ok: false, error: "consent denied" };
  const host = (opts.host ?? process.env.LUCIDA_HOST ?? "https://capture.lucidace.com").replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const e = {
      uuid: i.uuid ?? crypto.randomUUID(),
      event: i.event,
      distinct_id: i.distinctId,
      timestamp: i.timestamp instanceof Date ? i.timestamp.toISOString() : (i.timestamp ?? new Date().toISOString()),
      properties: { ...i.properties, ...(consent ? { $consent_analytics: consent } : {}), $lib: "lucida-node", $lib_version: LIB_VERSION },
      ...(i.$set || consent ? { $set: { ...i.$set, ...(consent ? { $consent_analytics: consent } : {}) } } : {}),
    };
    const r = await fetch(`${host}/v1/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, batch: [e], sent_at: new Date().toISOString() }),
      signal: ctl.signal,
    });
    return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: `status ${r.status}` };
  } catch (err) {
    return { ok: false, error: ctl.signal.aborted ? "timeout" : err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

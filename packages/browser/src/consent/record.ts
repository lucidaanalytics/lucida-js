import { uuidv7 } from "@lucida/sdk-core";
import type { ConsentState } from "@lucida/sdk-core";
import type { Host } from "../types.js";
import type { ConsentSource } from "./options.js";

export const CONSENT_EVENT = "$consent_updated";

/**
 * Apply a consent decision and write the consent-log record `$consent_updated` { categories, source, version }.
 * The record travels like any event, so it is sent only once analytics consent exists. A visitor who declines
 * analytics produces no record unless the page opted in with `consent.logBeacon`: then one anonymous event
 * (no distinct id, no session, no URL, no storage) is POSTed to /v1/batch, carrying only the decision.
 * `onlyIfChanged` (CMP bridges, which re-announce unchanged state) skips the record when nothing changed.
 */
export function applyConsent(
  host: Host,
  update: Partial<ConsentState>,
  source: ConsentSource,
  opts: { version?: string; onlyIfChanged?: boolean } = {},
): void {
  const before = JSON.stringify(host.core.getConsent());
  host.client.setConsent(update);
  const categories = host.core.getConsent();
  if (opts.onlyIfChanged && JSON.stringify(categories) === before) return;
  const props = { categories, source, version: opts.version ?? host.config.consent?.policyVersion ?? "1" };
  if (host.core.hasConsent("analytics")) host.client.capture(CONSENT_EVENT, props);
  else if (host.config.consent?.logBeacon && !host.config.disabled) {
    const body = JSON.stringify({
      api_key: host.apiKey,
      batch: [{ uuid: uuidv7(Date.now()), event: CONSENT_EVENT, timestamp: new Date().toISOString(), properties: { ...props, $lib: "lucida-browser" } }],
      sent_at: new Date().toISOString(),
    });
    void host.fetch(`${host.config.apiHost}/v1/batch`, { method: "POST", body, keepalive: true, credentials: "omit", headers: { "Content-Type": "text/plain" } }).catch(() => {});
  }
}

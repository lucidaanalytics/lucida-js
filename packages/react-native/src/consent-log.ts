import { uuidv7 } from "@lucida-analytics/sdk-core";
import type { Core } from "@lucida-analytics/sdk-core";
import type { NativeConfig } from "./types.js";

export const CONSENT_EVENT = "$consent_updated";

/**
 * Mirrors the browser SDK's consent log: after the decision, `$consent_updated { categories, source, version }`
 * is captured (the core stamps `$consent` on the person, which the server maps to `$consent_analytics`). A decliner
 * produces a record only with `consent.logBeacon`: one anonymous event (no distinct id, no storage) POSTed to /v1/batch.
 */
export function applyConsent(
  core: Core,
  o: { grant: boolean; config: NativeConfig; fetch: typeof fetch; apiHost: string; apiKey: string },
): void {
  if (o.grant) core.optIn();
  else core.optOut();
  const props = { categories: core.getConsent(), source: "app", version: o.config.consent?.policyVersion ?? "1" };
  if (core.hasConsent("analytics")) core.capture(CONSENT_EVENT, props);
  else if (o.config.consent?.logBeacon && !o.config.disabled) {
    const body = JSON.stringify({
      api_key: o.apiKey,
      batch: [{ uuid: uuidv7(Date.now()), event: CONSENT_EVENT, timestamp: new Date().toISOString(), properties: { ...props, $lib: "lucida-react-native" } }],
      sent_at: new Date().toISOString(),
    });
    void o.fetch(`${o.apiHost}/v1/batch`, { method: "POST", body, headers: { "Content-Type": "text/plain" } }).catch(() => undefined);
  }
}

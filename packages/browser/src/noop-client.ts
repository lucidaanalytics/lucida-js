import { flagResult } from "@lucida-analytics/sdk-core";
import type { Client } from "./types.js";

const off = (): void => {};
const empty = (): Promise<void> => Promise.resolve();
/** Members that are not "a function returning undefined". Everything else, nested groups (replay, ai, guides...) included, is a silent no-op. */
const FIXED: Record<string, unknown> = {
  isInternal: false,
  hasOptedOut: () => false,
  hasOptedIn: () => false,
  consentStatus: () => "pending",
  getConsentStatus: () => "pending",
  getConsent: () => ({ analytics: false, replay: false, marketing: false }),
  getAllFlags: () => ({}),
  isFeatureEnabled: () => false,
  getFlagResult: (k: string) => flagResult(k, undefined, undefined, "not_found"),
  getReplayUrl: () => "",
  onSessionId: () => off,
  onFlags: () => off,
  onIntervention: () => off,
  onConsent: () => off,
  flush: empty,
  shutdown: empty,
  reloadFlags: empty,
  loadToolbar: () => Promise.resolve(false),
  recommendations: (placement: string) => Promise.resolve({ placement, strategy: "", items: [], shown: off, clicked: off }),
};

function stub(top: boolean): unknown {
  return new Proxy((): unknown => undefined, {
    get: (_t, p) => {
      if (typeof p !== "string" || p === "then") return undefined; // never look like a thenable
      return top && Object.hasOwn(FIXED, p) ? FIXED[p] : stub(false);
    },
  });
}

/** What `init()` returns on the server (no window): the client's shape, every method a silent no-op. */
export const noopClient = (): Client => stub(true) as Client;

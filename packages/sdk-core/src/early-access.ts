import type { CaptureExtras } from "./core.js";
import type { Props } from "./ports.js";

/** One early-access feature as served by GET /v1/early-access (a flag plus a stage). */
export interface EarlyAccessFeature {
  flag_key: string;
  name: string;
  description?: string;
  stage: "alpha" | "beta" | "ga";
  /** Filled in by the SDK from this device's last opt-in/out. */
  enrolled?: boolean;
}

/** `client.earlyAccess`: list the features, opt in or out. */
export interface EarlyAccessService {
  list(): Promise<EarlyAccessFeature[]>;
  optIn(flagKey: string): void;
  optOut(flagKey: string): void;
}

export const EARLY_ACCESS_EVENT = "$early_access_opt_in";
/** Person property the flag's release condition matches on (services/lc-api early access). */
export const enrollmentProp = (flagKey: string): string => `$feature_enrollment/${flagKey}`;

/** The wire event for an opt-in/out: `$feature_flag`, `$enrolled`, plus the person property. */
export function enrollmentCapture(flagKey: string, enrolled: boolean): { event: string; props: Props; extra: CaptureExtras } {
  return {
    event: EARLY_ACCESS_EVENT,
    props: { $feature_flag: flagKey, $enrolled: enrolled },
    extra: { $set: { [enrollmentProp(flagKey)]: enrolled } },
  };
}

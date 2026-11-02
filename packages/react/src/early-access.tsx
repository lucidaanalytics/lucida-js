import type { EarlyAccessFeature } from "@lucida-analytics/browser";
import { useCallback, useEffect, useState } from "react";
import { useLucida } from "./hooks.js";

export interface UseEarlyAccess {
  features: EarlyAccessFeature[];
  /** Emits `$early_access_opt_in` (enrolled=true) and refreshes the local list. */
  optIn(flagKey: string): void;
  optOut(flagKey: string): void;
}

/** Early-access features for the project (needs the browser `earlyAccess` module); empty during SSR. */
export function useEarlyAccess(): UseEarlyAccess {
  const client = useLucida();
  const [features, setFeatures] = useState<EarlyAccessFeature[]>([]);
  const refresh = useCallback(() => void client?.earlyAccess.list().then(setFeatures), [client]);
  useEffect(refresh, [refresh]);
  const flip = (k: string, on: boolean): void => {
    if (on) client?.earlyAccess.optIn(k);
    else client?.earlyAccess.optOut(k);
    setFeatures((fs) => fs.map((f) => (f.flag_key === k ? { ...f, enrolled: on } : f)));
  };
  return { features, optIn: (k) => flip(k, true), optOut: (k) => flip(k, false) };
}

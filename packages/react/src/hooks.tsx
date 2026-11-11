import type { Client, FlagValue } from "@lucida-analytics/browser";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useLucidaContext } from "./provider.js";

export function useLucida(): Client | null {
  return useLucidaContext().client;
}

/** Stable capture function; a no-op while there is no client (SSR). */
export function useCapture(): Client["capture"] {
  const { client } = useLucidaContext();
  return useCallback((event, props, options) => client?.capture(event, props, options), [client]);
}

const NO_REPLAY: Client["replay"] = {
  start: () => Promise.resolve(),
  stop() {},
  pause() {},
  resume() {},
  tag() {},
  isRecording: () => false,
};

/** Recording control (start, stop, pause, resume, tag, isRecording); inert while there is no client (SSR). */
export function useReplay(): Client["replay"] {
  return useLucidaContext().client?.replay ?? NO_REPLAY;
}

/** Flag value from provider state; the exposure is recorded after mount, never during render. */
export function useFeatureFlag(key: string): FlagValue | undefined {
  const { client, flags } = useLucidaContext();
  const value = flags[key];
  useEffect(() => {
    if (value !== undefined) client?.getFlag(key);
  }, [client, key, value]);
  return value;
}

/** The variant key of a multivariate flag; undefined for booleans and unknown flags. */
export function useFeatureFlagVariant(key: string): string | undefined {
  const v = useFeatureFlag(key);
  return typeof v === "string" ? v : undefined;
}

export function useFeatureFlagPayload(key: string): unknown {
  const { client, flags } = useLucidaContext();
  // `flags` changing is what signals a payload may have changed.
  return useMemo(() => client?.getFlagPayload(key), [client, key, flags]);
}

/** Keys of all flags that are on (true or a variant). */
export function useActiveFeatureFlags(): string[] {
  const { flags } = useLucidaContext();
  return useMemo(() => Object.keys(flags).filter((k) => flags[k] !== false), [flags]);
}

export interface FeatureGateProps {
  flag: string;
  /** Render only for this variant; omit to match any on-value. */
  variant?: string;
  fallback?: ReactNode;
  children?: ReactNode;
}

export function FeatureGate({ flag, variant, fallback = null, children }: FeatureGateProps) {
  const v = useFeatureFlag(flag);
  const on = variant !== undefined ? v === variant : v !== undefined && v !== false;
  return <>{on ? children : fallback}</>;
}

const none = (): (() => void) => () => {};

/** Current distinct id (read at render; undefined during SSR). Re-render the component after `identify`/`reset` to refresh it. */
export function useDistinctId(): string | undefined {
  return useLucidaContext().client?.getDistinctId();
}

/** Current session id; re-renders when the session rotates. undefined during SSR. */
export function useSessionId(): string | undefined {
  const { client } = useLucidaContext();
  return useSyncExternalStore(
    (cb) => client?.onSessionId(cb) ?? none(),
    () => client?.getSessionId(),
    () => undefined,
  );
}

export interface UseConsent {
  /** "pending" until the visitor chooses, then "granted" or "denied"; re-renders on every change. */
  status: "pending" | "granted" | "denied";
  hasOptedIn: boolean;
  hasOptedOut: boolean;
  optIn: Client["optIn"];
  optOut: Client["optOut"];
  setConsent: Client["setConsent"];
}

/** Consent state plus the controls for a cookie banner. Inert ("pending") while there is no client (SSR). */
export function useConsent(): UseConsent {
  const { client } = useLucidaContext();
  const status = useSyncExternalStore(
    (cb) => client?.onConsent(cb) ?? none(),
    () => client?.consentStatus() ?? "pending",
    () => "pending" as const,
  );
  return {
    status,
    hasOptedIn: status === "granted",
    hasOptedOut: status === "denied",
    optIn: (c) => client?.optIn(c),
    optOut: () => client?.optOut(),
    setConsent: (u) => client?.setConsent(u),
  };
}

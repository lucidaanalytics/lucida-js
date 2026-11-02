import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLucidaContext } from "./provider.js";
import type { FlagValue, NativeClient, ReplayControl } from "./types.js";

export function useLucida(): NativeClient | null {
  return useLucidaContext().client;
}

/** Stable capture function; a no-op until the client is ready. */
export function useCapture(): NativeClient["capture"] {
  const { client } = useLucidaContext();
  return useCallback((event, props) => client?.capture(event, props), [client]);
}

const NO_REPLAY: ReplayControl = { start() {}, stop() {}, pause() {}, resume() {}, tag() {}, tap() {}, swipeBegan() {}, swipeEnded() {}, isRecording: () => false };

/** Recording control; inert until the client is ready. */
export function useReplay(): ReplayControl {
  return useLucidaContext().client?.replay ?? NO_REPLAY;
}

/** Records a `$screen` event when `name` changes (for apps not using react-navigation). */
export function useScreen(name: string, props?: Record<string, unknown>): void {
  const { client } = useLucidaContext();
  useEffect(() => {
    client?.screen(name, props);
    // props are deliberately not a dependency: a screen view is per name
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, name]);
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

export function useFeatureFlagVariant(key: string): string | undefined {
  const v = useFeatureFlag(key);
  return typeof v === "string" ? v : undefined;
}

export function useFeatureFlagPayload(key: string): unknown {
  const { client, flags } = useLucidaContext();
  // `flags` changing is what signals a payload may have changed.
  return useMemo(() => client?.getFlagPayload(key), [client, key, flags]);
}

export function useActiveFeatureFlags(): string[] {
  const { flags } = useLucidaContext();
  return useMemo(() => Object.keys(flags).filter((k) => flags[k] !== false), [flags]);
}

export interface FeatureGateProps {
  flag: string;
  variant?: string;
  fallback?: ReactNode;
  children?: ReactNode;
}

export function FeatureGate({ flag, variant, fallback = null, children }: FeatureGateProps) {
  const v = useFeatureFlag(flag);
  const on = variant !== undefined ? v === variant : v !== undefined && v !== false;
  return <>{on ? children : fallback}</>;
}

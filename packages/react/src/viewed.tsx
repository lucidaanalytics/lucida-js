import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useLucidaContext } from "./provider.js";
import { useFeatureFlag } from "./hooks.js";

/** Calls `cb` when the element becomes visible (>= `threshold` of it); once by default. A no-op where IntersectionObserver is missing (SSR, old browsers). */
function useViewed(cb: () => void, threshold: number, once: boolean, mounted = true) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(cb);
  latest.current = cb;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        latest.current();
        if (once) io.disconnect();
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once, mounted]);
  return ref;
}

export interface CaptureOnViewedProps {
  /** Event name (default `$element_viewed`). */
  event?: string;
  properties?: Record<string, unknown>;
  /** Share of the element that must be visible, 0..1 (default 0.1). */
  threshold?: number;
  /** Capture every time it scrolls into view instead of once (default false). */
  repeat?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Wraps children in a div and captures an event when it is scrolled into view. */
export function CaptureOnViewed({ event = "$element_viewed", properties, threshold = 0.1, repeat = false, className, style, children }: CaptureOnViewedProps) {
  const { client } = useLucidaContext();
  const ref = useViewed(() => client?.capture(event, properties), threshold, !repeat);
  return (
    <div ref={ref} {...(className ? { className } : {})} {...(style ? { style } : {})}>
      {children}
    </div>
  );
}

export interface FeatureProps {
  flag: string;
  /** Render only for this variant; omit to match any on-value. */
  match?: string;
  fallback?: ReactNode;
  /** Send `$feature_view` when the feature scrolls into view (default true). */
  trackView?: boolean;
  /** Send `$feature_interaction` on the first click inside the feature (default true). */
  trackInteraction?: boolean;
  threshold?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Flag-gated block that reports `$feature_view` (once, when visible) and `$feature_interaction` (first click). */
export function Feature({ flag, match, fallback = null, trackView = true, trackInteraction = true, threshold = 0.1, className, style, children }: FeatureProps) {
  const { client } = useLucidaContext();
  const v = useFeatureFlag(flag);
  const on = match !== undefined ? v === match : v !== undefined && v !== false;
  const clicked = useRef(false);
  const ref = useViewed(() => trackView && client?.featureView(flag), threshold, true, on);
  if (!on) return <>{fallback}</>;
  return (
    <div
      ref={ref}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
      onClick={() => {
        if (!trackInteraction || clicked.current) return;
        clicked.current = true;
        client?.featureInteraction(flag);
      }}
    >
      {children}
    </div>
  );
}

/**
 * Visible time on the current page: counts milliseconds while the tab is visible and stops while it is
 * hidden. `reset()` starts the next page (SPA route). Sent as `$engagement_time_ms` on `$pageleave`.
 */
export function engagementTimer(now: () => number = () => performance.now()): {
  read(): number;
  reset(): void;
  stop(): void;
} {
  const visible = (): boolean => document.visibilityState !== "hidden";
  let acc = 0;
  let since: number | null = visible() ? now() : null;
  const onVis = (): void => {
    if (!visible()) {
      if (since !== null) acc += now() - since;
      since = null;
    } else if (since === null) since = now();
  };
  document.addEventListener("visibilitychange", onVis);
  return {
    read: () => Math.round(acc + (since === null ? 0 : now() - since)),
    reset: () => {
      acc = 0;
      since = visible() ? now() : null;
    },
    stop: () => document.removeEventListener("visibilitychange", onVis),
  };
}

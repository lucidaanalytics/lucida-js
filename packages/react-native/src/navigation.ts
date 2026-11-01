import type { NativeClient } from "./types.js";

/** The slice of a react-navigation container ref used for screen tracking (optional peer). */
export interface NavigationRefLike {
  getCurrentRoute(): { name: string; params?: Record<string, unknown> } | undefined;
}

/**
 * Screen tracking for react-navigation. Wire both handlers on `<NavigationContainer>`:
 * `onReady` records the first screen, `onStateChange` records changes (deduped by route name).
 * Route params are not sent (they often hold PII); pass `includeParams` to opt in.
 */
export function screenTracker(
  client: Pick<NativeClient, "screen">,
  ref: { current: NavigationRefLike | null },
  opts: { includeParams?: boolean } = {},
): { onReady(): void; onStateChange(): void } {
  let last: string | undefined;
  const track = (): void => {
    const r = ref.current?.getCurrentRoute();
    if (!r || r.name === last) return;
    last = r.name;
    client.screen(r.name, opts.includeParams && r.params ? { $screen_params: r.params } : {});
  };
  return { onReady: track, onStateChange: track };
}

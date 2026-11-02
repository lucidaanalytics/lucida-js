import { useLucida } from "@lucida-analytics/react";
import { useEffect } from "react";

/**
 * `$route` for a TanStack Router route id: `/_authed/posts/$postId/` becomes `/posts/$postId`.
 * Pathless layout segments (`_authed`) and the root id (`__root__`) carry no URL and are dropped.
 */
export function routeIdTemplate(routeId: string | undefined): string {
  if (!routeId || routeId === "__root__") return "/";
  const segs = routeId.split("/").filter((s) => s && !s.startsWith("_"));
  return `/${segs.join("/")}`;
}

/** The slice of a TanStack router `trackRouter` reads. Any `createRouter()` result fits. */
export interface TanstackRouterLike {
  state: { location: { pathname: string; search?: unknown }; matches: ReadonlyArray<{ routeId: string }> };
  subscribe(event: "onResolved", fn: (e: { toLocation: { pathname: string; search?: unknown }; pathChanged?: boolean; hrefChanged?: boolean }) => void): () => void;
}

export interface CaptureClient {
  capture(event: string, props?: Record<string, unknown>): void;
}

/**
 * One `$pageview` for the page that is already showing, then one per resolved navigation, with `$route` taken from the
 * deepest match and `$referrer` set to the previous page. Returns the unsubscribe. Use with `capturePageview: false`.
 */
export function trackRouter(router: TanstackRouterLike, client: CaptureClient): () => void {
  let prevUrl: string | undefined;
  const view = (): void => {
    const matches = router.state.matches;
    client.capture("$pageview", {
      $route: routeIdTemplate(matches[matches.length - 1]?.routeId),
      ...(prevUrl ? { $referrer: prevUrl } : {}),
    });
    prevUrl = location.href;
  };
  view();
  return router.subscribe("onResolved", (e) => {
    if (e.pathChanged === false && e.hrefChanged === false) return;
    view();
  });
}

/** Component form of `trackRouter`: render once inside `LucidaProvider`. Pass the router from `useRouter()`. */
export function LucidaPageviews({ router }: { router: TanstackRouterLike }) {
  const client = useLucida();
  useEffect(() => (client ? trackRouter(router, client) : undefined), [client, router]);
  return null;
}

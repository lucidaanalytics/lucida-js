import { useLucida } from "@lucida-analytics/react";
import { useEffect, useRef } from "react";

/** The slice of a React Router match this package reads (data routers: `router.state.matches`, `useMatches()`). */
export interface MatchLike {
  route: { path?: string | undefined; index?: boolean | undefined };
}

/**
 * Route template from the matched route chain: `[{path:"blog"},{path:":slug"}]` becomes `/blog/:slug`.
 * Pathless layout and index routes contribute nothing; an absolute child path (starting with "/") restarts the template.
 */
export function routeTemplateFromMatches(matches: readonly MatchLike[]): string {
  let out = "";
  for (const m of matches) {
    const p = m.route.path;
    if (!p) continue;
    out = p.startsWith("/") ? p : `${out.replace(/\/$/, "")}/${p}`;
  }
  return out === "" ? "/" : out.startsWith("/") ? out : `/${out}`;
}

export interface LucidaPageviewsProps {
  /** `useLocation().pathname`. */
  pathname: string;
  /** `useLocation().search`: part of the identity of a view, so `?page=2` counts as a new one. */
  search?: string;
  /** Route template for `$route` (see `routeTemplateFromMatches`); omit to send plain pageviews. */
  template?: string;
}

/**
 * One `$pageview` per navigation, with `$route` when a template is given and `$referrer` set to the previous page.
 * Render once inside `<LucidaProvider options={{ capturePageview: false, capturePageleave: true }}>` and a router:
 *
 * ```tsx
 * const loc = useLocation();
 * const matches = useMatches(); // data routers
 * <LucidaPageviews pathname={loc.pathname} search={loc.search} template={routeTemplateFromMatches(matches)} />
 * ```
 */
export function LucidaPageviews({ pathname, search = "", template }: LucidaPageviewsProps) {
  const client = useLucida();
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!client) return;
    client.capture("$pageview", { ...(template ? { $route: template } : {}), ...(prev.current ? { $referrer: prev.current } : {}) });
    prev.current = location.href;
  }, [client, pathname, search, template]);
  return null;
}

/** The slice of a data router (`createBrowserRouter`, framework mode `router`) `trackRouter` uses. */
export interface DataRouterLike {
  state: { location: { pathname: string; search: string }; matches: readonly MatchLike[] };
  subscribe(fn: (state: DataRouterLike["state"]) => void): () => void;
}

/** The slice of the browser client `trackRouter` needs. */
export interface CaptureClient {
  capture(event: string, props?: Record<string, unknown>): void;
}

/**
 * Non-React alternative for data routers: captures the first view now and one per completed navigation.
 * Returns the unsubscribe. Same `capturePageview: false` rule as `LucidaPageviews`.
 */
export function trackRouter(router: DataRouterLike, client: CaptureClient): () => void {
  let prevUrl: string | undefined;
  let last = "";
  const view = (s: DataRouterLike["state"]): void => {
    const key = `${s.location.pathname}${s.location.search}`;
    if (key === last) return; // loading/revalidation re-emits the same location
    last = key;
    client.capture("$pageview", { $route: routeTemplateFromMatches(s.matches), ...(prevUrl ? { $referrer: prevUrl } : {}) });
    prevUrl = location.href;
  };
  view(router.state);
  return router.subscribe(view);
}

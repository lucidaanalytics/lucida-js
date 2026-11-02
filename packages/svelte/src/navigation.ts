/** What `afterNavigate` passes (SvelteKit's `AfterNavigate`, structurally): no `@sveltejs/kit` import needed. */
export interface NavigationLike {
  type: string;
  from?: { url: { href: string } } | null;
  to: { route: { id: string | null }; url: { href: string } } | null;
}

export interface CaptureClient {
  capture(event: string, props?: Record<string, unknown>): void;
}

/** `/(app)/posts/[id]` -> `/posts/[id]`: layout groups carry no URL segment. */
export function routeTemplateOf(routeId: string | null | undefined): string {
  if (!routeId) return "/";
  const segs = routeId.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segs.join("/")}`;
}

/**
 * SPA pageviews for SvelteKit: call once in the root `+layout.svelte` script with `afterNavigate` from
 * `$app/navigation` (it must run during component init). SvelteKit fires it for the first page (`type: "enter"`)
 * and for every client-side navigation, so use it with `capturePageview: false`. `$route` is the route id with
 * layout groups removed and `$referrer` the previous page.
 *
 * ```svelte
 * <script>
 *   import { afterNavigate } from "$app/navigation";
 *   import { trackNavigation } from "@lucida-analytics/svelte";
 *   trackNavigation(afterNavigate, lucida.client);
 * </script>
 * ```
 */
export function trackNavigation(afterNavigate: (cb: (nav: NavigationLike) => void) => void, client: CaptureClient | null | undefined): void {
  afterNavigate((nav) => {
    if (!client || !nav.to || nav.type === "leave") return;
    client.capture("$pageview", {
      $route: routeTemplateOf(nav.to.route.id),
      ...(nav.from ? { $referrer: nav.from.url.href } : {}),
    });
  });
}

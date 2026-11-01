"use client";

import { useLucida } from "@lucida/react";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { routeTemplate } from "./route.js";

/** Captures one `$pageview` per route change with `$route` set to `template`. Shared by both routers. */
function usePageviews(key: string, template: string) {
  const client = useLucida();
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!client) return;
    const href = location.href;
    client.capture("$pageview", { $route: template, ...(prev.current ? { $referrer: prev.current } : {}) });
    prev.current = href;
    // key = the concrete URL path: a change of params on the same template is still a new page view.
  }, [client, key, template]);
}

/**
 * App Router: one `$pageview` per navigation carrying `$route` (`/blog/[slug]`). Render it once inside the provider
 * and set `routeTemplates` on `LucidaNextProvider`, which turns the SDK's own pageview capture off so views are not doubled.
 */
export function LucidaRouteViews() {
  const pathname = usePathname() ?? "/";
  const params = useParams() as Record<string, string | string[] | undefined> | null;
  usePageviews(pathname, routeTemplate(pathname, params ?? {}));
  return null;
}

/** Pages Router: `router.pathname` is already the template. Pass `useRouter()` from `next/router`. */
export function LucidaPagesRouteViews({ router }: { router: { pathname: string; asPath: string } }) {
  usePageviews(router.asPath.split("?")[0] ?? router.asPath, router.pathname);
  return null;
}

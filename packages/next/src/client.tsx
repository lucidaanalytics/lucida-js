"use client";

import { LucidaProvider } from "@lucida/react";
import type { BrowserConfig } from "@lucida/browser";
import type { ReactNode } from "react";
import { PAGE_PROP } from "./pages.js";
import { LucidaPagesRouteViews, LucidaRouteViews } from "./route-views.js";
import type { Bootstrap } from "./shared.js";

export * from "@lucida/react";
export { LucidaRouteViews, LucidaPagesRouteViews } from "./route-views.js";
export { routeTemplate } from "./route.js";

export interface LucidaNextProviderProps {
  apiKey: string;
  /** From `getBootstrap` (App Router) so the first client render matches the server. */
  bootstrap?: Bootstrap;
  /** Browser SDK options. `apiHost` defaults to "/ingest" (see `lucidaRewrites`). */
  options?: BrowserConfig;
  /**
   * App Router: send each `$pageview` with `$route` (`/blog/[slug]`). The SDK's own pageview capture is switched off
   * (views come from `LucidaRouteViews`; `$pageleave` still fires on route changes).
   */
  routeTemplates?: boolean;
  /** Pages Router `useRouter()` result: sends `$route` from `router.pathname` the same way. */
  router?: { pathname: string; asPath: string };
  children?: ReactNode;
}

/** `LucidaProvider` wired for Next: first-party `/ingest` host, server bootstrap for flags and the distinct id. */
export function LucidaNextProvider({ apiKey, bootstrap, options, routeTemplates, router, children }: LucidaNextProviderProps) {
  const templated = !!routeTemplates || !!router;
  const merged: BrowserConfig = {
    apiHost: "/ingest",
    ...(templated ? { capturePageview: false, capturePageleave: true } : {}),
    ...options,
    ...(bootstrap ? { bootstrap: { ...options?.bootstrap, distinctId: bootstrap.distinctId } } : {}),
  };
  return (
    <LucidaProvider apiKey={apiKey} options={merged} {...(bootstrap ? { bootstrapFlags: bootstrap.flags } : {})}>
      {routeTemplates ? <LucidaRouteViews /> : null}
      {router ? <LucidaPagesRouteViews router={router} /> : null}
      {children}
    </LucidaProvider>
  );
}

/** Pages Router: reads the bootstrap `withLucida` put into `pageProps`. Use in `_app.tsx`. */
export function LucidaPagesProvider({ pageProps, ...rest }: Omit<LucidaNextProviderProps, "bootstrap" | "routeTemplates"> & { pageProps: Record<string, unknown> }) {
  const b = pageProps[PAGE_PROP] as Bootstrap | undefined;
  return <LucidaNextProvider {...rest} {...(b ? { bootstrap: b } : {})} />;
}

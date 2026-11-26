"use client";

import { LucidaProvider } from "@lucida-analytics/react";
import type { BrowserConfig, Module } from "@lucida-analytics/browser";
import type { ReactNode } from "react";
import { PAGE_PROP } from "./pages.js";
import { LucidaPagesRouteViews, LucidaRouteViews } from "./route-views.js";
import type { Bootstrap } from "./shared.js";

export * from "@lucida-analytics/react";
export { LucidaRouteViews, LucidaPagesRouteViews } from "./route-views.js";
export { routeTemplate } from "./route.js";

export interface LucidaNextProviderProps {
  apiKey: string;
  /** From `getBootstrap` (App Router) so the first client render matches the server. */
  bootstrap?: Bootstrap;
  /**
   * Browser SDK options. `apiHost` defaults to "/ingest" only when `withLucidaRewrites()` (or `NEXT_PUBLIC_LUCIDA_REWRITE`)
   * configured the proxy, else to https://capture.lucidace.com, so a missing rewrite never drops events silently.
   * In development a 404 from a same-origin `apiHost` logs one console.error.
   */
  options?: BrowserConfig;
  /** Browser modules (third `init` argument), e.g. `[cookieMunchConsent]` from `@lucida-analytics/browser/consent`. Read once, when the client is created. */
  modules?: Module[];
  /**
   * App Router: send each `$pageview` with `$route` (`/blog/[slug]`). The SDK's own pageview capture is switched off
   * (views come from `LucidaRouteViews`; `$pageleave` still fires on route changes).
   */
  routeTemplates?: boolean;
  /** Pages Router `useRouter()` result: sends `$route` from `router.pathname` the same way. */
  router?: { pathname: string; asPath: string };
  /** Your signed-in user id (e.g. `session?.user.id ?? null`): identifies on sign-in, resets on sign-out (never on an initial signed-out render). */
  identify?: string | null | undefined;
  /** Person properties sent with `identify`. */
  identifyProps?: Record<string, unknown> | undefined;
  children?: ReactNode;
}

/** Written out in full so Next inlines it at build time. */
function rewriteMarker(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_LUCIDA_REWRITE || undefined;
  } catch {
    return undefined;
  }
}

let warned = false;
/** Development only: the first 404 from a same-origin ingest path almost always means the rewrite is missing. */
function watch404(host: string, inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const r = await inner(input, init);
    if (r.status === 404 && !warned) {
      warned = true;
      console.error(`[lucida] 404 from ${host}: rewrite missing. Add withLucidaRewrites() to next.config, or set options.apiHost (e.g. "https://capture.lucidace.com").`);
    }
    return r;
  };
}

/** `LucidaProvider` wired for Next: first-party `/ingest` host when the rewrite is configured, else the cloud host, server bootstrap for flags and the distinct id. */
export function LucidaNextProvider({ apiKey, bootstrap, options, modules, routeTemplates, router, identify, identifyProps, children }: LucidaNextProviderProps) {
  const templated = !!routeTemplates || !!router;
  const marker = rewriteMarker();
  const apiHost = options?.apiHost ?? marker ?? "https://capture.lucidace.com";
  const dev = typeof process !== "undefined" && process.env.NODE_ENV === "development";
  const sameOrigin = apiHost.startsWith("/");
  const merged: BrowserConfig = {
    apiHost,
    ...(dev && sameOrigin ? { fetch: watch404(apiHost, (options?.fetch ?? ((...a) => fetch(...a)))) } : {}),
    exposeGlobal: true, // window.lucida, like the script build; pass `exposeGlobal: false` to opt out
    ...(templated ? { capturePageview: false, capturePageleave: true } : {}),
    ...options,
    ...(bootstrap ? { bootstrap: { ...options?.bootstrap, distinctId: bootstrap.distinctId } } : {}),
  };
  return (
    <LucidaProvider apiKey={apiKey} options={merged} {...(modules ? { modules } : {})} {...(identify !== undefined ? { identify } : {})} {...(identifyProps ? { identifyProps } : {})} {...(bootstrap ? { bootstrapFlags: bootstrap.flags } : {})}>
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

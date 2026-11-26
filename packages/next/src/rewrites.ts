export interface RewriteOptions {
  /** Same-origin path the browser SDK talks to (set `apiHost` to this). Default "/ingest". */
  path?: string;
  /** Lucida ingest/flags host to forward to. Default https://capture.lucidace.com */
  host?: string;
}

/** Env marker `withLucidaRewrites` sets (inlined at build) so `LucidaNextProvider` knows the same-origin proxy exists. */
export const REWRITE_ENV = "NEXT_PUBLIC_LUCIDA_REWRITE";

export interface Rewrite {
  source: string;
  destination: string;
}

/**
 * Reverse-proxy rules for `next.config.js` `rewrites()`: serve Lucida from your own domain so ad blockers and
 * strict CSPs see first-party traffic. Only the public SDK surface (/v1/*) is forwarded.
 *
 * ```js
 * const { lucidaRewrites } = require("@lucida-analytics/next");
 * module.exports = { skipTrailingSlashRedirect: true, async rewrites() { return lucidaRewrites(); } };
 * ```
 * and init the browser SDK with `apiHost: "/ingest"`. Prefer `withLucidaRewrites`, which also tells `LucidaNextProvider`
 * the proxy exists (without that marker the provider sends straight to https://capture.lucidace.com).
 */
export function lucidaRewrites(o: RewriteOptions = {}): Rewrite[] {
  const path = `/${(o.path ?? "/ingest").replace(/^\/+|\/+$/g, "")}`;
  const host = (o.host ?? "https://capture.lucidace.com").replace(/\/+$/, "");
  return [{ source: `${path}/v1/:path*`, destination: `${host}/v1/:path*` }];
}

interface NextConfigLike {
  env?: Record<string, string>;
  rewrites?: () => unknown | Promise<unknown>;
  [k: string]: unknown;
}

/**
 * `next.config.js` wrapper: adds the Lucida rewrites (beforeFiles, next to yours), `skipTrailingSlashRedirect`, and the
 * `NEXT_PUBLIC_LUCIDA_REWRITE` marker so `LucidaNextProvider` defaults `apiHost` to the proxy path.
 *
 * ```js
 * const { withLucidaRewrites } = require("@lucida-analytics/next");
 * module.exports = withLucidaRewrites({ reactStrictMode: true });
 * ```
 */
export function withLucidaRewrites<C extends NextConfigLike>(config: C = {} as C, o: RewriteOptions = {}): C {
  const ours = lucidaRewrites(o);
  const path = `/${(o.path ?? "/ingest").replace(/^\/+|\/+$/g, "")}`;
  return {
    ...config,
    skipTrailingSlashRedirect: true,
    env: { ...config.env, [REWRITE_ENV]: path },
    async rewrites() {
      const theirs = (await config.rewrites?.()) as Rewrite[] | { beforeFiles?: Rewrite[] } | undefined;
      if (!theirs) return { beforeFiles: ours };
      if (Array.isArray(theirs)) return { beforeFiles: [...ours, ...theirs] };
      return { ...theirs, beforeFiles: [...ours, ...(theirs.beforeFiles ?? [])] };
    },
  };
}

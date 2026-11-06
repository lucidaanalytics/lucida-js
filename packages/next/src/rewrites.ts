export interface RewriteOptions {
  /** Same-origin path the browser SDK talks to (set `apiHost` to this). Default "/ingest". */
  path?: string;
  /** Lucida ingest/flags host to forward to. Default https://capture.lucidace.com */
  host?: string;
}

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
 * and init the browser SDK with `apiHost: "/ingest"`.
 */
export function lucidaRewrites(o: RewriteOptions = {}): Rewrite[] {
  const path = `/${(o.path ?? "/ingest").replace(/^\/+|\/+$/g, "")}`;
  const host = (o.host ?? "https://capture.lucidace.com").replace(/\/+$/, "");
  return [{ source: `${path}/v1/:path*`, destination: `${host}/v1/:path*` }];
}

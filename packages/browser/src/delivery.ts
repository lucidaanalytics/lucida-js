import type { Transport } from "@lucida-analytics/sdk-core";
import type { LazyModuleName } from "./config-types.js";
import type { Module } from "./types.js";

/** Protocols of browser-extension pages (popup, options, side panel). */
const EXTENSION_PROTOCOLS = ["chrome-extension:", "moz-extension:", "safari-web-extension:", "ms-browser-extension:"];

export const isExtensionPage = (): boolean => typeof location !== "undefined" && EXTENSION_PROTOCOLS.includes(location.protocol);

/** Immutable, versioned URL of an SDK static file: `<assetHost>/static/v<version>/<file>`. */
export const assetUrl = (assetHost: string, version: string, file: string): string =>
  `${assetHost.replace(/\/+$/, "")}/static/v${version}/${file}`;

/** The module each lazily loadable entry exports. */
export const LAZY_EXPORTS: Record<LazyModuleName, string> = {
  replay: "replay",
  heatmaps: "heatmaps",
  forms: "forms",
  toolbar: "toolbar",
  guides: "guides",
  inspector: "inspector",
  experiments: "visualChanges",
  "early-access": "earlyAccess",
  consent: "consentModule", // the banner API plus the Cookie Munch follower
};

export type Importer = (url: string) => Promise<Record<string, unknown>>;

const nativeImport: Importer = (url) => import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>;

/** `manifest.json` beside the SDK files: the sha384 of `lucida.js` and every `<name>.js` of this version. */
export interface Manifest {
  version: string;
  files: Record<string, string>;
}

/** The version's manifest, or undefined when there is none (an old deploy) or it cannot be read. */
export async function fetchManifest(assetHost: string, version: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<Manifest | undefined> {
  try {
    const r = await fetchImpl(assetUrl(assetHost, version, "manifest.json"), { credentials: "omit" });
    if (!r.ok) return undefined;
    const m = (await r.json()) as Partial<Manifest>;
    return m && typeof m.files === "object" && m.files ? (m as Manifest) : undefined;
  } catch {
    return undefined;
  }
}

/** `sha384-<base64>` of the bytes, as in an `integrity` attribute. Throws without WebCrypto (an insecure page). */
export async function sri384(bytes: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-384", bytes));
  return `sha384-${btoa(String.fromCharCode(...d))}`;
}

/**
 * Loads the named ESM entries from the versioned asset path (same version as this script, so a pinned loader always
 * gets matching modules). A module that fails to load is logged and skipped; the client still starts.
 * With a manifest, each module is fetched and hashed (WebCrypto SHA-384) against it before it runs; a mismatch, a
 * module the manifest does not list, or no WebCrypto refuses it. No manifest (an old deploy): load as before.
 * shortcut: the verified bytes are fetched again by `import()` (immutable URL, so the HTTP cache serves it), and
 * lazy chunks a module imports are not hashed; upgrade to blob-import plus chunk hashes when needed.
 */
export async function loadModules(
  names: readonly LazyModuleName[],
  base: { assetHost: string; version: string },
  log: (...a: unknown[]) => void,
  importer: Importer = nativeImport,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Module[]> {
  const manifest = names.length ? await fetchManifest(base.assetHost, base.version, fetchImpl) : undefined;
  const got = await Promise.all(
    names.map(async (n) => {
      const exp = LAZY_EXPORTS[n];
      if (!exp) return log("unknown module", n);
      const url = assetUrl(base.assetHost, base.version, `${n}.js`);
      try {
        if (manifest) {
          const want = manifest.files[`${n}.js`];
          const res = want ? await fetchImpl(url, { credentials: "omit", cache: "force-cache" }) : undefined;
          if (!res?.ok || (await sri384(await res.arrayBuffer())) !== want) return log("module refused, it does not match the manifest", n);
        }
        const m = (await importer(url))[exp];
        return typeof m === "function" ? (m as Module) : log("module has no export", n, exp);
      } catch (e) {
        return log("module failed to load", n, e);
      }
    }),
  );
  return got.filter((m): m is Module => !!m);
}

/** URL with its path rewritten when it points at one of `origins` (query kept); other URLs pass through. */
export function rewriteUrl(url: string, origins: readonly string[], rewrite: (path: string) => string): string {
  const o = origins.find((x) => url.startsWith(`${x}/`));
  if (!o) return url;
  const rest = url.slice(o.length);
  const q = rest.search(/[?#]/);
  return o + rewrite(q < 0 ? rest : rest.slice(0, q)) + (q < 0 ? "" : rest.slice(q));
}

/** Applies `rewritePath` to the ingest transport and to the fetch modules use (flags, config, guides). */
export function withRewrite(
  transport: Transport,
  fetchImpl: typeof fetch,
  origins: readonly string[],
  rewrite: ((path: string) => string) | undefined,
): { transport: Transport; fetch: typeof fetch } {
  if (!rewrite) return { transport, fetch: fetchImpl };
  const rw = (u: string): string => rewriteUrl(u, origins, rewrite);
  return {
    transport: { send: (url, body, o) => transport.send(rw(url), body, o) },
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetchImpl(typeof input === "string" ? rw(input) : input instanceof URL ? rw(input.href) : input, init)) as typeof fetch,
  };
}

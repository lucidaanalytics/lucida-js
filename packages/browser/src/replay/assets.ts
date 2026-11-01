import { visitAttributes } from "./visit.js";
import type { DomEvent, GetNode } from "./visit.js";

/** Opt-in asset capture (LC-EXP-64). Off by default; local config only. */
export interface AssetCapture {
  /** Inline same-origin / CORS-readable images into the recording as data URLs (rrweb `inlineImages`). Refused under mask-all-text. */
  inlineImages?: boolean;
  /** Inlined images larger than this (data URL characters, default 256 KB) are dropped; the element keeps its URL. */
  maxInlineBytes?: number;
  /** Record web fonts loaded with the FontFace API (rrweb `collectFonts`). */
  collectFonts?: boolean;
  /**
   * Rewrites asset URLs (img/source/video src and srcset, poster, stylesheet links, CSS `url()` incl. fonts) from
   * `origins` to `${url}?url=<encoded original>`, so the player loads CORS-blocked or expiring assets through your
   * proxy. `url` must be on the page's origin or the Lucida host; any other proxy is ignored.
   */
  proxy?: { url: string; origins: string[] };
}

export interface ResolvedAssets {
  inlineImages: boolean;
  maxInlineBytes: number;
  collectFonts: boolean;
  proxy: { url: string; origins: string[] } | null;
}

/** The proxy only when it is http(s) on one of `trusted` origins (page, apiHost, uiHost). */
export function resolveAssets(a: AssetCapture | undefined, maskAllText: boolean, trusted: string[]): ResolvedAssets | null {
  if (!a) return null;
  let proxy: ResolvedAssets["proxy"] = null;
  try {
    const u = a.proxy && new URL(a.proxy.url, location.href);
    if (u && /^https?:$/.test(u.protocol) && trusted.includes(u.origin) && a.proxy?.origins.length) proxy = { url: u.toString(), origins: [...a.proxy.origins] };
  } catch {
    /* malformed proxy URL: ignored */
  }
  return { inlineImages: !!a.inlineImages && !maskAllText, maxInlineBytes: a.maxInlineBytes ?? 256 * 1024, collectFonts: !!a.collectFonts, proxy };
}

const IMG_TAGS = new Set(["img", "source", "video", "audio", "track", "image", "input"]);
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Rewrites asset URLs (proxy) and enforces the inline size cap on full snapshots, mutations and inserted CSS rules. */
export function assetScrubber(a: ResolvedAssets) {
  const proxied = (raw: string): string => {
    if (!a.proxy || raw.startsWith("data:")) return raw;
    try {
      const u = new URL(raw, location.href);
      if (!a.proxy.origins.includes(u.origin)) return raw;
      return `${a.proxy.url}${a.proxy.url.includes("?") ? "&" : "?"}url=${encodeURIComponent(u.toString())}`;
    } catch {
      return raw;
    }
  };
  const css = (s: string): string => s.replace(CSS_URL, (m, q: string, u: string) => {
    const p = proxied(u.trim());
    return p === u.trim() ? m : `url(${q}${p}${q})`;
  });
  const srcset = (s: string): string =>
    s.split(",").map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return u ? [proxied(u), ...rest].join(" ") : part;
    }).join(", ");
  const visit = (attrs: Record<string, unknown>, tag: string): void => {
    if (tag === "img" && typeof attrs.rr_dataURL === "string" && attrs.rr_dataURL.length > a.maxInlineBytes) delete attrs.rr_dataURL;
    if (!a.proxy) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (typeof v !== "string") continue;
      if (k === "_cssText" || k === "style") attrs[k] = css(v);
      else if (k === "srcset") attrs[k] = srcset(v);
      else if (k === "poster" || (k === "src" && IMG_TAGS.has(tag)) || (k === "href" && tag === "link") || (k === "xlink:href" && tag === "image")) attrs[k] = proxied(v);
    }
  };
  return {
    scrub(e: DomEvent, getNode: GetNode): void {
      visitAttributes(e, getNode, visit);
      // StyleSheetRule (source 8) inserts: font and background URLs inside the rule text
      if (a.proxy && e.type === 3 && e.data?.source === 8) for (const r of e.data.adds ?? []) if (typeof r.rule === "string") r.rule = css(r.rule);
    },
  };
}

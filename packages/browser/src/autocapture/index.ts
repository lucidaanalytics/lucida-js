import type { AutocaptureConfig, Module } from "../types.js";
import { startContentCapture } from "./content.js";
import { startEditCopyCapture } from "./edit-copy.js";
import { startEventCapture, urlMatches } from "./events.js";
import { startLinkCapture } from "./links.js";
import { startMediaCapture } from "./media.js";
import { startPageviews } from "./pageview.js";

export { attrProps, buildChain, chainToString, MASKED } from "./chain.js";
export { cssSelector } from "./click.js";
export { maskCopied } from "./edit-copy.js";
export { isStepper } from "./frustration.js";
export { tag404, DOWNLOAD_EXTENSIONS, SEARCH_PARAMS } from "./links.js";
export { mediaSrc } from "./media.js";
export type { ElementInfo, MaskOptions } from "./chain.js";

/**
 * Autocapture module: click/change/submit, contenteditable edits, copy/cut, outbound/download/site-search, media,
 * SPA pageviews, pageleave + scroll depth. `urlIgnorelist` switches all but pageviews off on matching pages.
 */
export const autocapture: Module = (host) => {
  const stops: Array<() => void> = [];
  const ac = host.config.autocapture;
  let remoteOff = false;
  if (ac !== false) {
    const cfg: AutocaptureConfig = typeof ac === "object" ? ac : {};
    const on = (): boolean => !remoteOff && !(cfg.urlIgnorelist?.length && urlMatches(cfg.urlIgnorelist));
    stops.push(
      startEventCapture(host, cfg, on),
      startEditCopyCapture(host, cfg, on),
      startLinkCapture(host, cfg, on),
      startContentCapture(host, cfg, on),
      startMediaCapture(host, cfg, on),
    );
    // Remote config can switch autocapture off unless the page set it explicitly.
    if (ac === undefined) void host.loadConfig().then((r) => (remoteOff = r?.autocapture === false));
  }
  const pv = host.config.capturePageview ?? "history";
  const pl = host.config.capturePageleave ?? "if_capture_pageview";
  // capturePageleave:true with pageviews off still needs route tracking for the leave events.
  if (pv !== false && pl !== false) stops.push(startPageviews(host, pv));
  else if (pv !== false) stops.push(startPageviews(host, pv, { leave: false }));
  else if (pl === true) stops.push(startPageviews(host, "history", { views: false }));
  return () => stops.forEach((s) => s());
};

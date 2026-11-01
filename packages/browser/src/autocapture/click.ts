import type { Props } from "@lucida/sdk-core";
import type { AutocaptureConfig, Host } from "../types.js";
import { rageHint, watchDeadClick } from "./frustration.js";

const IDENT = /^[A-Za-z_][\w-]*$/;
const MAX_LEVELS = 5;

/**
 * Descendant-combinator selector (`body div.card button#buy`) in the subset crates/lc-replay's
 * selector engine understands: tag, #id, .class. Stops at the first id; max 5 levels.
 */
export function cssSelector(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && parts.length < MAX_LEVELS; e = e.parentElement) {
    const tag = e.tagName.toLowerCase();
    if (e.id && IDENT.test(e.id)) {
      parts.unshift(`${tag}#${e.id}`);
      break;
    }
    const cls = (e.getAttribute("class") ?? "").split(/\s+/).filter((c) => IDENT.test(c)).slice(0, 2);
    parts.unshift(tag + cls.map((c) => `.${c}`).join(""));
  }
  return parts.join(" ");
}

/**
 * Props lc-worker / lc-signals read from a click: `$click_x`/`$click_y` (page-relative px),
 * `$selector`, `$el_interactive` (rage/dead-click detection is server-side), plus module extras.
 */
export function clickProps(host: Host, ev: MouseEvent, target: Element, interactive: boolean, cfg: AutocaptureConfig = {}): Props {
  const p: Props = { $selector: cssSelector(target), $el_interactive: interactive };
  if (ev.clientX || ev.clientY || ev.detail) {
    p.$click_x = Math.round(ev.clientX + (window.scrollX || 0));
    p.$click_y = Math.round(ev.clientY + (window.scrollY || 0));
  }
  if (cfg.rageClicks !== false && !target.closest(".lc-no-rageclick,[data-lc-no-rageclick]")) Object.assign(p, rageHint(ev, Date.now(), cfg.rageClicks || {}, target));
  const dead = cfg.deadClicks;
  if (!interactive && ev.isTrusted && dead !== false && !(dead?.ignoreSelectors?.length && target.closest(dead.ignoreSelectors.join(",")))) {
    watchDeadClick(host, p.$selector as string, dead?.waitMs);
  }
  for (const f of host.clickExtras) Object.assign(p, f(ev, target));
  return p;
}

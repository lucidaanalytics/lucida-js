import type { Props } from "@lucida-analytics/sdk-core";
import type { FrustrationConfig, Host } from "../types.js";

const DEAD_WAIT_MS = 700;

interface Pt {
  t: number;
  x: number;
  y: number;
}
const recent: Pt[] = [];

/** Label of a control that steps a value or a slide: + / - and arrow glyphs. */
const STEP_GLYPH = /^[+\-−–‹›<>«»←→↑↓▲▼▶◀^ˇ˄˅]$/;
const STEP_WORD = /\b(increase|decrease|increment|decrement|plus|minus|add one|remove one|next|prev|previous|scroll (left|right))\b/i;
const STEP_CLASS = /(^|[-_\s])(stepper|spinner|quantity|qty|increment|decrement|inc|dec|plus|minus|carousel|slider|swiper|slick|glide|splide|arrow|next|prev)([-_\s]|$)/i;
const BUTTONISH = "button,[role=button],a,input[type=button],input[type=submit],[role=spinbutton]";

/**
 * Repeated clicks here are the intended use, not frustration: number inputs and spinbuttons, +/- and arrow buttons,
 * and controls whose class, aria-label or title names a stepper, quantity or carousel, plus your `extra` selectors.
 */
export function isStepper(target: Element, extra: readonly string[] = []): boolean {
  if (extra.length && target.closest(extra.join(","))) return true;
  if (target.closest('input[type=number],[role=spinbutton],[role=slider]')) return true;
  const ctl = target.closest(BUTTONISH) ?? target;
  const label = `${ctl.getAttribute("aria-label") ?? ""} ${ctl.getAttribute("title") ?? ""}`;
  if (STEP_GLYPH.test((ctl.textContent ?? "").trim()) || STEP_WORD.test(label)) return true;
  for (let el: Element | null = ctl, d = 0; el && d < 3; el = el.parentElement, d++) {
    if (STEP_CLASS.test(el.getAttribute("class") ?? "")) return true;
  }
  return false;
}

const selecting = (): boolean => (typeof getSelection === "function" ? (getSelection()?.toString() ?? "") !== "" : false);

/**
 * Client hints only (lc-signals stays authoritative): `$rageclick` + `$rageclick_count` when >= `count` (3) clicks land
 * within `windowMs` (1s) and `radiusPx` (30) of each other (the count includes this click). Props ride on the click
 * event itself. Clicks inside `ignoreSelectors`, or while text is selected, are not counted.
 */
export function rageHint(ev: MouseEvent, now = Date.now(), cfg: FrustrationConfig = {}, target?: Element): Props {
  if (target && cfg.ignoreSelectors?.length && target.closest(cfg.ignoreSelectors.join(","))) return {};
  if (target && cfg.suppressSteppers !== false && isStepper(target, cfg.stepperSelectors)) return {};
  if (cfg.ignoreTextSelection !== false && selecting()) return {};
  const windowMs = cfg.windowMs ?? 1000;
  const radius = cfg.radiusPx ?? 30;
  if (recent.length && now < recent[recent.length - 1]!.t) recent.length = 0; // the clock went backwards
  recent.push({ t: now, x: ev.clientX, y: ev.clientY });
  while (recent.length && now - recent[0]!.t > windowMs) recent.shift();
  const near = recent.filter((p) => Math.hypot(p.x - ev.clientX, p.y - ev.clientY) <= radius).length;
  return near >= (cfg.count ?? 3) ? { $rageclick: true, $rageclick_count: near } : {};
}

/**
 * A click event is captured synchronously, so "nothing changed afterwards" cannot ride on it. After
 * the click, if no DOM mutation, scroll or text selection happens within `waitMs`, send `$deadclick_hint` with the
 * same selector. Non-interactive targets only: interactive ones usually act through JS we cannot see.
 */
export function watchDeadClick(host: Host, selector: string, waitMs = DEAD_WAIT_MS): void {
  if (typeof MutationObserver === "undefined") return;
  let changed = false;
  const mo = new MutationObserver(() => (changed = true));
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const flag = (): void => void (changed = true);
  window.addEventListener("scroll", flag, { capture: true, passive: true });
  document.addEventListener("selectionchange", flag);
  const stop = (): void => {
    mo.disconnect();
    window.removeEventListener("scroll", flag, { capture: true });
    document.removeEventListener("selectionchange", flag);
  };
  const t = setTimeout(() => {
    stop();
    if (!changed && document.visibilityState !== "hidden") {
      host.client.capture("$deadclick_hint", { $selector: selector, $no_mutation_ms: waitMs });
    }
  }, waitMs);
  host.onUnload(() => {
    clearTimeout(t);
    stop();
  });
}

import { propOk } from "../targeting.js";
import type { GuideAutomation, GuideStep } from "../types.js";

// Step behaviour extras (P-M41, N-DAP-6, N-DAP-15): branch rules on the page / flags, automation actions
// with their safety refusals, and the finish confetti.

type Branch = NonNullable<GuideStep["branch"]>[number];

export interface BranchCtx {
  person?: Record<string, unknown>;
  /** The SDK's evaluated flag: on when served and not false. */
  flag?: (key: string) => boolean;
}

const present = (sel: unknown): boolean => {
  if (typeof sel !== "string" || !sel) return false;
  try {
    return !!document.querySelector(sel);
  } catch {
    return false; // an invalid selector is "not present"
  }
};

/** One branch rule: element presence (checked now), flag state, else a person-property test. */
export function branchOk(r: Branch, ctx: BranchCtx): boolean {
  if (r.op === "element_present") return present(r.value);
  if (r.op === "element_absent") return !present(r.value);
  if (r.op === "flag_on" || r.op === "flag_off") {
    const on = typeof r.value === "string" && !!ctx.flag?.(r.value);
    return r.op === "flag_on" ? on : !on;
  }
  return propOk({ key: r.key, op: r.op, value: r.value }, ctx.person);
}

/** Fields an automation never touches: passwords, masked fields and card data. */
export function sensitive(el: Element): boolean {
  if (el.matches("input[type=password],[data-lc-mask],.lc-mask,[autocomplete^=cc-]")) return true;
  return !!el.closest("[data-lc-mask],.lc-mask"); // inside a masked region
}

const FILLABLE = "input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]),textarea";

export type AutomationResult = "done" | "missing" | "refused" | "invalid";

/**
 * Click, focus or fill the automation target. `fill` writes the builder's constant through the native value
 * setter (so frameworks see it) and fires input + change; the current value is never read.
 */
export function runAutomation(a: GuideAutomation, doc: Document = document): AutomationResult {
  if (!a.selector || a.selector.length > 500) return "invalid";
  let el: Element | null;
  try {
    el = doc.querySelector(a.selector);
  } catch {
    return "invalid";
  }
  if (!el) return "missing";
  if (sensitive(el)) return "refused";
  if (a.action === "click") (el as HTMLElement).click();
  else if (a.action === "focus") (el as HTMLElement).focus();
  else if (a.action === "fill") {
    if (typeof a.value !== "string" || a.value.length > 200 || !el.matches(FILLABLE)) return "refused";
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, a.value);
    else (el as HTMLInputElement).value = a.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else return "invalid";
  return "done";
}

const reducedMotion = (): boolean => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** A short canvas confetti burst (about 1.5 s), drawn over the page and removed after. No-op under reduced motion. */
export function confetti(colors: string[] = ["#e5484d", "#30a46c", "#0090ff", "#f5d90a", "#8e4ec6"]): void {
  if (typeof document === "undefined" || reducedMotion()) return;
  const c = document.createElement("canvas");
  c.setAttribute("data-lc-ignore", "");
  c.setAttribute("aria-hidden", "true");
  c.width = innerWidth;
  c.height = innerHeight;
  c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483001";
  const ctx = c.getContext("2d");
  if (!ctx) return;
  document.body.append(c);
  const bits = Array.from({ length: 120 }, (_, i) => ({
    x: innerWidth / 2,
    y: innerHeight / 3,
    vx: (Math.random() - 0.5) * 12,
    vy: Math.random() * -10 - 2,
    color: colors[i % colors.length]!,
  }));
  const end = Date.now() + 1500;
  const frame = (): void => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.vy += 0.35;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, 6, 4);
    }
    if (Date.now() < end) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

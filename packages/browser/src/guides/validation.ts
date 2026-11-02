import { styleTag } from "../csp.js";
import type { Guide, GuideRule } from "../types.js";
import { place, type GuideHooks, type RenderOpts } from "./render.js";
import { paint, resolveTokens } from "./theme.js";

// Form-validation guides (P-L9): each step names a field and its format rules. On blur and on submit the
// SDK checks the value IN THE PAGE and shows the rule's message next to the field. Values never leave the
// page: `$guide_validation_failed` carries only the guide, step and rule type.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s().-]{7,20}$/;
const CSS =
  ".v{position:fixed;z-index:2147483000;background:#fff;color:#b42318;border:1px solid #f04438;border-radius:6px;padding:6px 10px;font:13px system-ui;max-width:280px;box-shadow:0 2px 8px rgba(0,0,0,.15)}";

/** The first rule `value` breaks, or null. An empty optional field passes every rule but `required`. */
export function failedRule(value: string, rules: GuideRule[]): GuideRule | null {
  const v = value.trim();
  for (const r of rules) {
    if (r.type === "required") {
      if (!v) return r;
      continue;
    }
    if (!v) continue;
    const n = typeof r.value === "number" ? r.value : Number(r.value);
    const bad =
      (r.type === "email" && !EMAIL.test(v)) ||
      (r.type === "url" && !isUrl(v)) ||
      (r.type === "phone" && !(PHONE.test(v) && v.replace(/\D/g, "").length >= 7)) ||
      (r.type === "regex" && !regexOk(v, r.value)) ||
      (r.type === "min_length" && Number.isFinite(n) && v.length < n) ||
      (r.type === "max_length" && Number.isFinite(n) && v.length > n) ||
      (r.type === "number" && !Number.isFinite(Number(v)));
    if (bad) return r;
  }
  return null;
}

function isUrl(v: string): boolean {
  try {
    return /^https?:$/.test(new URL(v).protocol);
  } catch {
    return false;
  }
}

function regexOk(v: string, pattern: unknown): boolean {
  if (typeof pattern !== "string" || pattern.length > 500) return true;
  try {
    return new RegExp(pattern).test(v);
  } catch {
    return true; // a broken pattern never blocks the person
  }
}

const valueOf = (el: Element): string | null =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : null;

/**
 * Bind every step's field (fields that mount later are picked up every 500 ms). A failing submit is held back
 * (prevented in the capture phase) while a message shows. Returns the teardown.
 */
export function renderValidation(g: Guide, hooks: GuideHooks, done: () => void, opts: RenderOpts = {}): () => void {
  const host = document.createElement("div");
  host.setAttribute("data-lc-ignore", "");
  const root = host.attachShadow({ mode: "open" });
  root.append(styleTag(CSS, opts.nonce));
  document.body.append(host);
  const bound = new WeakSet<Element>();
  const tips = new Map<string, HTMLElement>();
  const offs: Array<() => void> = [];
  let stopped = false;

  /** Check one step's field; shows or clears its message. True = valid. */
  const check = (stepId: string, el: Element, rules: GuideRule[]): boolean => {
    const v = valueOf(el);
    if (v === null) return true;
    const bad = failedRule(v, rules);
    tips.get(stepId)?.remove();
    tips.delete(stepId);
    el.removeAttribute("aria-invalid");
    if (!bad) return true;
    const tip = document.createElement("div");
    tip.className = "v";
    tip.setAttribute("role", "alert");
    tip.textContent = bad.message; // builder text, never markup
    const t = resolveTokens(g.appearance);
    delete t.background; // the message keeps its error colors
    delete t.text;
    paint(tip, t);
    root.append(tip);
    place(tip, el, "bottom");
    tips.set(stepId, tip);
    el.setAttribute("aria-invalid", "true");
    hooks.validationFailed?.(stepId, bad.type);
    return false;
  };

  const bind = (): void => {
    for (const s of g.steps) {
      const v = s.validation;
      if (!v?.selector || !v.rules?.length) continue;
      let els: Element[];
      try {
        els = [...document.querySelectorAll(v.selector)];
      } catch {
        continue;
      }
      for (const el of els) {
        if (bound.has(el)) continue;
        bound.add(el);
        const blur = (): void => void check(s.id, el, v.rules);
        el.addEventListener("blur", blur);
        offs.push(() => el.removeEventListener("blur", blur));
        const form = el.closest("form");
        if (!form) continue;
        const submit = (e: Event): void => {
          if (!check(s.id, el, v.rules)) (e.preventDefault(), e.stopPropagation());
        };
        form.addEventListener("submit", submit, true);
        offs.push(() => form.removeEventListener("submit", submit, true));
      }
    }
  };
  const timer = setInterval(bind, 500);
  bind();
  hooks.shown();
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const o of offs) o();
    host.remove();
    done();
  };
}

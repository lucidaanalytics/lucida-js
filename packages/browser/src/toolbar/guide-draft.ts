import { cssSelector } from "../autocapture/click.js";
import { sensitive } from "../guides/step-extras.js";
import type { Guide, GuideAutomation, GuideStep } from "../types.js";
import type { GuideDoc } from "./api.js";

export const STABLE_ATTRS = ["data-lc-id", "data-testid", "data-test", "data-cy", "data-qa"];
const IDENT = /^[A-Za-z_][\w-]*$/;
const KINDS_ONE_STEP = new Set<Guide["kind"]>(["tooltip", "modal", "banner", "announcement", "hotspot", "beacon", "badge", "slideout", "inline"]);
const NEEDS_SELECTOR = new Set<Guide["kind"]>(["tooltip", "tour", "hotspot", "beacon", "badge", "inline"]);
/** Kinds with a step-count range other than "one" or "any". */
const STEP_RANGE: Partial<Record<Guide["kind"], [number, number]>> = { carousel: [1, 10], form_validation: [1, 30] };
const FILLABLE = "input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]),textarea";

/** Selector that survives redesigns: stable data attribute (`attrs`, in preference order), then id, then the toolbar's structural selector. */
export function stableSelector(el: Element, attrs: readonly string[] = STABLE_ATTRS): string {
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (v && !/["\\]/.test(v)) return `[${a}="${v}"]`;
  }
  if (el.id && IDENT.test(el.id)) return `#${el.id}`;
  return cssSelector(el);
}

export interface GuideDraft {
  id?: string;
  name: string;
  kind: Guide["kind"];
  steps: GuideStep[];
  /** Suggested targeting from an AI draft; default: this page's path. */
  targeting?: Record<string, unknown>;
}

export const newDraft = (): GuideDraft => ({ name: "", kind: "tooltip", steps: [] });

export function addStep(d: GuideDraft, s: Omit<GuideStep, "id">): GuideStep {
  const step = { ...s, id: `s${d.steps.length + 1}` };
  d.steps.push(step);
  return step;
}

/** Client-side mirror of the server rules (guides_model.rs) so errors show before a round trip. */
export function validateDraft(d: GuideDraft): string | null {
  if (!d.name.trim()) return "Name the guide";
  if (!d.steps.length) return "Add at least one step";
  if (KINDS_ONE_STEP.has(d.kind) && d.steps.length !== 1) return `A ${d.kind} has exactly one step`;
  const range = STEP_RANGE[d.kind];
  if (range && (d.steps.length < range[0] || d.steps.length > range[1])) return `A ${d.kind} has ${range[0]} to ${range[1]} steps`;
  for (const [i, s] of d.steps.entries()) {
    if (d.kind === "form_validation") {
      if (!s.validation?.selector || !s.validation.rules?.length) return `Step ${i + 1} needs a field and at least one rule`;
      continue;
    }
    if (!s.title?.trim() && !s.body?.trim()) return `Step ${i + 1} needs a title or body`;
    if (NEEDS_SELECTOR.has(d.kind) && !s.selector) return `Step ${i + 1} needs a picked element`;
    const a = s.automation ? checkAutomation(s.automation) : null;
    if (a) return `Step ${i + 1}: ${a}`;
  }
  return null;
}

/** Wire document; shown on the current page path (or the AI draft's suggestion) until the owner edits targeting in the app. */
export function toDoc(d: GuideDraft, path: string): GuideDoc {
  return { name: d.name.trim(), kind: d.kind, steps: d.steps, targeting: d.targeting ?? { url: path, url_match: "exact" } };
}

/** Preview model for renderGuide. */
export const toPreview = (d: GuideDraft): Guide => ({ id: d.id ?? "preview", name: d.name, kind: d.kind, steps: d.steps, conditions: {} });

/**
 * Builder-time check of an automation target on the live page (N-DAP-15), mirroring the SDK's refusals: the selector
 * must be valid and match exactly one element, never a password / masked / card field, and `fill` needs a text field
 * and a constant. Null = fine.
 */
export function checkAutomation(a: GuideAutomation, doc: Document = document): string | null {
  if (!a.selector || a.selector.length > 500) return "automation needs a selector (max 500 chars)";
  let els: Element[];
  try {
    els = [...doc.querySelectorAll(a.selector)];
  } catch {
    return `invalid selector ${a.selector}`;
  }
  if (!els.length) return `nothing on this page matches ${a.selector}`;
  if (els.length > 1) return `${a.selector} matches ${els.length} elements; pick a unique one`;
  const el = els[0]!;
  if (sensitive(el)) return "automations never touch password, masked or card fields";
  if (a.action === "fill") {
    if (typeof a.value !== "string" || !a.value || a.value.length > 200) return "fill needs a value (max 200 chars)";
    if (!el.matches(FILLABLE)) return "fill needs a text field";
  }
  return null;
}

/** One click captured in record mode: where it happened and the clicked control's short label. */
export interface RecordedStep {
  selector: string;
  url: string;
  text?: string;
}

/** A short visible label for a clicked control; never from form fields or masked regions. */
function labelOf(el: Element): string | undefined {
  if (el.matches("input,textarea,select") || sensitive(el)) return undefined;
  const t = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ");
  return t ? t.slice(0, 80) : undefined;
}

/**
 * Record mode (N-DAP-8a): every click on the page (outside Lucida's own UI) becomes a tour step with a stable
 * selector and its page path, up to `max`. The click still happens, so the person walks the flow normally.
 * Returns the stopper.
 */
export function recordClicks(onStep: (s: RecordedStep) => void, attrs: readonly string[] = STABLE_ATTRS, max = 30): () => void {
  let n = 0;
  const on = (e: MouseEvent): void => {
    const t = e.target;
    if (!(t instanceof Element) || e.composedPath().some((x) => x instanceof Element && x.hasAttribute("data-lc-ignore"))) return;
    if (n >= max) return;
    n++;
    const el = t.closest("button,a,[role=button],input,select,textarea,label,[data-lc-id],[data-testid]") ?? t;
    const text = labelOf(el);
    onStep({ selector: stableSelector(el, attrs), url: location.pathname, ...(text ? { text } : {}) });
  };
  document.addEventListener("click", on, true);
  return () => document.removeEventListener("click", on, true);
}

/** Offline fallback when the draft route is unavailable: one click-advance tour step per recorded click. */
export function recordedToDraft(rec: RecordedStep[]): GuideDraft {
  const d: GuideDraft = { name: "Recorded tour", kind: "tour", steps: [] };
  for (const r of rec) addStep(d, { title: r.text ? `Click "${r.text}"` : "Next step", body: "Continue here.", selector: r.selector, url: r.url, advance: "click" });
  return d;
}

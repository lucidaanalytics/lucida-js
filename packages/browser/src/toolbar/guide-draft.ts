import { cssSelector } from "../autocapture/click.js";
import type { Guide, GuideStep } from "../types.js";
import type { GuideDoc } from "./api.js";

export const STABLE_ATTRS = ["data-lc-id", "data-testid", "data-test", "data-cy", "data-qa"];
const IDENT = /^[A-Za-z_][\w-]*$/;
const KINDS_ONE_STEP = new Set<Guide["kind"]>(["tooltip", "modal", "banner", "announcement", "hotspot", "beacon", "badge", "slideout", "inline"]);
const NEEDS_SELECTOR = new Set<Guide["kind"]>(["tooltip", "tour", "hotspot", "beacon", "badge", "inline"]);

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
  for (const [i, s] of d.steps.entries()) {
    if (!s.title?.trim() && !s.body?.trim()) return `Step ${i + 1} needs a title or body`;
    if (NEEDS_SELECTOR.has(d.kind) && !s.selector) return `Step ${i + 1} needs a picked element`;
  }
  return null;
}

/** Wire document; shown on the current page path until the owner edits targeting in the app. */
export function toDoc(d: GuideDraft, path: string): GuideDoc {
  return { name: d.name.trim(), kind: d.kind, steps: d.steps, targeting: { url: path, url_match: "exact" } };
}

/** Preview model for renderGuide. */
export const toPreview = (d: GuideDraft): Guide => ({ id: d.id ?? "preview", name: d.name, kind: d.kind, steps: d.steps, conditions: {} });

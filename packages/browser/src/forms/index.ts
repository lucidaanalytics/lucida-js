import { sha256Hex } from "@lucida-analytics/sdk-core";
import type { Module } from "../types.js";

const IGNORE = "[data-lc-ignore]";
const FIELD = "input,select,textarea";

/** Opaque, stable field/form identifier. Names and labels are hashed; values are never read. */
export function fieldId(el: Element): string {
  const f = el as HTMLInputElement;
  const label = f.labels?.[0]?.textContent?.trim() ?? el.getAttribute("aria-label") ?? "";
  return sha256Hex(`${f.name ?? ""}|${el.id}|${label}`).slice(0, 12);
}

function formId(form: HTMLFormElement): string {
  let path = "";
  try {
    path = new URL(form.action || location.href, location.href).pathname;
  } catch {
    /* keep empty */
  }
  const idx = Array.from(document.forms).indexOf(form);
  return sha256Hex(`${form.id}|${form.getAttribute("name") ?? ""}|${path}|${idx}`).slice(0, 12);
}

function hasError(el: Element): boolean {
  if (el.getAttribute("aria-invalid") === "true") return true;
  try {
    return el.matches(":invalid");
  } catch {
    return false;
  }
}

interface FormState {
  id: string;
  startedAt: number;
  submitted: boolean;
  last?: string;
  touched: Set<string>;
}

/**
 * Privacy-safe form analytics: `$form_start`, `$form_field_interact` (field id hash, interaction
 * ms, refill count, error flag), `$form_submit`, `$form_abandon` (last field) on pagehide. No
 * value, placeholder or label text is ever sent; [data-lc-ignore] subtrees are skipped.
 */
export const forms: Module = (host) => {
  const state = new WeakMap<HTMLFormElement, FormState>();
  const open = new Set<FormState>();
  const visits = new Map<string, { n: number; since: number }>();

  const target = (ev: Event): { el: Element; form: HTMLFormElement } | undefined => {
    const el = ev.target;
    if (!(el instanceof Element) || !el.matches(FIELD) || el.closest(IGNORE)) return;
    const form = (el as HTMLInputElement).form;
    return form ? { el, form } : undefined;
  };
  const get = (form: HTMLFormElement): FormState => {
    let s = state.get(form);
    if (!s) {
      s = { id: formId(form), startedAt: Date.now(), submitted: false, touched: new Set() };
      state.set(form, s);
      open.add(s);
      host.client.capture("$form_start", { form: s.id, $form_field_count: form.querySelectorAll(FIELD).length });
    }
    return s;
  };

  const onIn = (ev: Event): void => {
    const t = target(ev);
    if (!t) return;
    const s = get(t.form);
    const id = fieldId(t.el);
    const v = visits.get(s.id + id);
    visits.set(s.id + id, { n: (v?.n ?? 0) + 1, since: Date.now() });
    s.last = id;
    s.touched.add(id);
  };
  const onOut = (ev: Event): void => {
    const t = target(ev);
    const s = t && state.get(t.form);
    if (!t || !s) return;
    const id = fieldId(t.el);
    const v = visits.get(s.id + id);
    if (!v) return;
    host.client.capture("$form_field_interact", {
      form: s.id,
      field: id,
      $field_type: t.el.tagName === "INPUT" ? (t.el as HTMLInputElement).type : t.el.tagName.toLowerCase(),
      interaction_ms: Date.now() - v.since,
      refill_count: v.n - 1,
      error: hasError(t.el),
    });
  };
  const onSubmit = (ev: Event): void => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement) || form.closest(IGNORE)) return;
    const s = get(form);
    s.submitted = true;
    open.delete(s);
    host.client.capture("$form_submit", {
      form: s.id,
      $duration_ms: Date.now() - s.startedAt,
      $fields_touched: s.touched.size,
    });
  };

  document.addEventListener("focusin", onIn, true);
  document.addEventListener("focusout", onOut, true);
  document.addEventListener("submit", onSubmit, true);
  host.onUnload(() => {
    for (const s of open) {
      if (s.submitted) continue;
      host.client.capture("$form_abandon", {
        form: s.id,
        last_field: s.last,
        $fields_touched: s.touched.size,
        $duration_ms: Date.now() - s.startedAt,
      });
    }
    open.clear();
  });
  return () => {
    document.removeEventListener("focusin", onIn, true);
    document.removeEventListener("focusout", onOut, true);
    document.removeEventListener("submit", onSubmit, true);
  };
};

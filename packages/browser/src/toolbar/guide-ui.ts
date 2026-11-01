import { renderGuide } from "../guides/render.js";
import type { Guide } from "../types.js";
import { GUIDE_SCOPE } from "./api.js";
import type { SavedGuide, toolbarApi } from "./api.js";
import { addStep, newDraft, stableSelector, toDoc, toPreview, validateDraft } from "./guide-draft.js";
import type { GuideDraft } from "./guide-draft.js";

/** Every guide kind lc-api accepts (guides_model::KINDS). */
const KINDS: Guide["kind"][] = ["tooltip", "modal", "banner", "tour", "checklist", "resource_center", "announcement", "hotspot", "beacon", "badge", "launcher", "slideout", "inline"];

export interface BuilderDeps {
  api: ReturnType<typeof toolbarApi>;
  scopes: string[] | undefined;
  /** Element chosen with the toolbar's inspector, if any. */
  picked: () => Element | undefined;
  note: (t: string) => void;
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), props);
const btn = (label: string, on: () => void): HTMLButtonElement => {
  const b = mk("button", { textContent: label, type: "button" });
  b.style.cssText = "margin:2px;padding:4px 8px;font:12px system-ui;cursor:pointer";
  b.onclick = on;
  return b;
};

/**
 * No-code guide builder (LC-ENG-7): pick an element, write content, preview live, save through
 * POST/PUT /v1/projects/{id}/guides. Without the `guides:write` scope the editor works for preview
 * but Save is disabled with an explanation (never a silent failure).
 */
export function guideBuilder(d: BuilderDeps): HTMLElement {
  const root = mk("div");
  let draft: GuideDraft = newDraft();
  let stopPreview: (() => void) | undefined;
  const canWrite = !!d.scopes?.includes(GUIDE_SCOPE);

  const name = mk("input", { placeholder: "Guide name" });
  const kind = mk("select");
  for (const k of KINDS) kind.append(mk("option", { value: k, textContent: k }));
  const title = mk("input", { placeholder: "Step title" });
  const body = mk("textarea", { placeholder: "Step body", rows: 2 });
  const image = mk("input", { placeholder: "Image URL (https, optional)" });
  const alt = mk("input", { placeholder: "Image description (alt text)" });
  for (const e of [name, title, body, image, alt]) e.setAttribute("aria-label", e.placeholder);
  const placement = mk("select");
  for (const p of ["bottom", "top", "left", "right"]) placement.append(mk("option", { value: p, textContent: p }));
  const sel = mk("div");
  const list = mk("div");
  list.style.whiteSpace = "pre-wrap";
  let selector = "";

  const refresh = (): void => {
    sel.textContent = selector ? `Element: ${selector}` : "No element picked";
    list.textContent = draft.steps.map((s, i) => `${i + 1}. ${s.title ?? s.body ?? s.id}${s.selector ? ` @ ${s.selector}` : ""}`).join("\n");
  };
  const sync = (): void => {
    draft.name = name.value;
    draft.kind = kind.value as Guide["kind"];
  };
  const preview = (): void => {
    sync();
    stopPreview?.();
    const g = toPreview(draft);
    if (!g.steps.length) return d.note("Add a step first");
    const noop = { shown() {}, step() {}, completed() {}, dismissed() {}, event() {} };
    stopPreview = renderGuide(g, noop, () => (stopPreview = undefined)); // hooks send no events: previews never reach analytics
  };
  const load = (g: SavedGuide): void => {
    draft = { id: g.id, name: g.name, kind: g.kind, steps: g.steps };
    name.value = g.name;
    kind.value = g.kind;
    refresh();
  };

  const save = btn("Save guide", async () => {
    sync();
    const err = validateDraft(draft);
    if (err) return d.note(err);
    const doc = toDoc(draft, location.pathname);
    const r = draft.id ? await d.api.updateGuide(draft.id, doc) : await d.api.createGuide(doc);
    if (r) draft.id = r.id;
    d.note(r ? `Guide saved (${r.id}), start it from the app` : "Could not save guide");
  });
  if (!canWrite) {
    save.disabled = true;
    save.title = `Requires the ${GUIDE_SCOPE} toolbar scope`;
  }

  root.append(
    mk("b", { textContent: "Guide builder" }),
    mk("br"),
    name,
    kind,
    btn("Pick element", () => {
      const el = d.picked();
      selector = el ? stableSelector(el) : "";
      refresh();
      if (!el) d.note("Use Inspect element first, then Pick element");
    }),
    sel,
    title,
    body,
    image,
    alt,
    placement,
    btn("Add step", () => {
      sync();
      addStep(draft, {
        ...(title.value ? { title: title.value } : {}),
        ...(body.value ? { body: body.value } : {}),
        ...(selector ? { selector, placement: placement.value as "top" } : {}),
        ...(image.value.startsWith("https://") && alt.value.trim() ? { media: [{ type: "image" as const, url: image.value, alt: alt.value.trim() }] } : {}),
      });
      title.value = body.value = image.value = alt.value = "";
      selector = "";
      refresh();
    }),
    btn("Remove last", () => (draft.steps.pop(), refresh())),
    list,
    btn("Preview", preview),
    btn("Close preview", () => stopPreview?.()),
    save,
    btn("Load existing", async () => {
      const gs = await d.api.listGuides();
      const g = gs.find((x) => x.name === name.value) ?? gs[0];
      if (g) load(g);
      else d.note("No guides yet");
    }),
    btn("New", () => ((draft = newDraft()), (name.value = ""), refresh())),
    mk("div", { textContent: canWrite ? "" : `Saving requires the ${GUIDE_SCOPE} scope on the toolbar token.` }),
  );
  refresh();
  return root;
}

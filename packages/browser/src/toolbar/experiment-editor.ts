import { applyChanges, changesOf, CHANGES_KEY } from "../experiments/changes.js";
import { EXPERIMENT_SCOPE } from "./api.js";
import type { EditorExperiment, toolbarApi } from "./api.js";
import { bindUndoKeys, createEditor } from "./editor.js";
import { DEVICES, devicePreview } from "./device-preview.js";
import type { Device } from "./device-preview.js";
import type { InsertPosition } from "../experiments/changes.js";
import { stableSelector } from "./guide-draft.js";
import { pageOutline } from "./outline.js";

export interface ExperimentEditorDeps {
  api: ReturnType<typeof toolbarApi>;
  scopes: string[] | undefined;
  experimentId: string;
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
const labelled = (text: string, control: HTMLElement): HTMLLabelElement => {
  const l = mk("label", { textContent: `${text} ` });
  l.style.display = "block";
  l.append(control);
  return l;
};

/** The variants with `variant`'s change list replaced (other payload keys and variants untouched). */
export function withChanges(exp: EditorExperiment, variant: string, changes: unknown[]): EditorExperiment["variants"] {
  return exp.variants.map((v) => (v.key === variant ? { ...v, payload: { ...v.payload, [CHANGES_KEY]: changes } } : v));
}

/**
 * Standalone visual editor (LC-EXT-37), opened from the experiment page in the app: edit one variant
 * of a web experiment on the live site (text, style, attributes, hide, reorder, inserted HTML, image
 * swap or upload, page CSS / JS; optionally only on this page for multipage tests), undo / redo
 * (buttons, Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z), a device-width preview, save the change list to the
 * variant, and turn a clicked element into a goal metric. Saving needs the experiments:write toolbar
 * scope and a draft experiment; page CSS / JS and inserted HTML need the project's
 * `experiment.custom_code` approval before the experiment starts (P-H5).
 */
export async function experimentEditor(d: ExperimentEditorDeps): Promise<HTMLElement> {
  const root = mk("div");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Experiment visual editor");
  const exp = await d.api.experiment(d.experimentId);
  if (!exp) {
    root.textContent = "Could not load the experiment (check the toolbar scope and project).";
    return root;
  }
  const canWrite = !!d.scopes?.includes(EXPERIMENT_SCOPE);
  const variant = mk("select");
  for (const v of exp.variants) variant.append(mk("option", { value: v.key, textContent: v.key }));
  variant.value = exp.variants[1]?.key ?? exp.variants[0]?.key ?? "";
  const pageOnly = mk("input", { type: "checkbox" });
  const list = mk("ul");
  const undo = btn("Undo", () => editor.undo());
  const redo = btn("Redo", () => editor.redo());
  undo.setAttribute("aria-keyshortcuts", "Control+Z Meta+Z");
  redo.setAttribute("aria-keyshortcuts", "Control+Shift+Z Meta+Shift+Z");
  let editor = createEditor();
  const preview = devicePreview(() => editor.changes());
  let offChange = (): void => {};
  const load = (): void => {
    const v = exp.variants.find((x) => x.key === variant.value);
    offChange();
    editor = createEditor(changesOf(v?.payload), () => pageOnly.checked);
    offChange = editor.onChange(() => (draw(), preview.update()));
    applyChanges(changesOf(v?.payload, location.href)); // show the variant's saved edits on this page
    draw();
  };
  const draw = (): void => {
    list.replaceChildren();
    editor.changes().forEach((c, i) => {
      const li = mk("li", { textContent: `${c.type} ${c.selector ?? "(page)"}${c.url ? ` (on ${c.url})` : ""} ` });
      li.append(btn(`Remove change ${i + 1}`, () => editor.remove(i)));
      list.append(li);
    });
    undo.disabled = !editor.canUndo();
    redo.disabled = !editor.canRedo();
  };
  const offKeys = bindUndoKeys(() => editor);
  const device = mk("select");
  for (const k of Object.keys(DEVICES) as Device[]) device.append(mk("option", { value: k, textContent: k === "desktop" ? "Desktop (this window)" : `${k} (${DEVICES[k]}px)` }));
  device.onchange = () => preview.open(device.value as Device);
  const code = (label: string, kind: "css" | "js", hint: string): HTMLElement => {
    const ta = mk("textarea", { rows: 4, placeholder: hint });
    ta.style.cssText = "width:100%;font:12px ui-monospace,monospace";
    const wrap = labelled(label, ta);
    wrap.append(btn(`Set ${label.toLowerCase()}`, () => (ta.value.trim() ? editor[kind](ta.value) : d.note("Write some code first"))));
    return wrap;
  };
  const pickImage = mk("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp" });
  pickImage.style.display = "none";
  pickImage.onchange = async () => {
    const el = d.picked();
    const f = pickImage.files?.[0];
    pickImage.value = "";
    if (!el || !f) return;
    const url = await d.api.uploadAsset(f);
    if (url) editor.image(el, url);
    else d.note("Upload failed: PNG, JPEG, GIF or WebP up to 2 MiB, with the experiments:write scope");
  };
  variant.onchange = () => (d.note("Reload the page to see the other variant without this one's edits"), load());
  const need = (f: (el: Element) => void) => (): void => {
    const el = d.picked();
    if (!el) return d.note("Inspect an element first");
    f(el);
    draw();
  };
  const ask = (label: string, q: string, f: (el: Element, v: string) => void): HTMLButtonElement =>
    btn(label, need((el) => {
      const v = window.prompt(q);
      if (v !== null) f(el, v);
    }));
  const goal = mk("input", { placeholder: "Goal name" });
  const save = btn("Save variant", async () => {
    const r = await d.api.saveVariants(exp.id, withChanges(exp, variant.value, [...editor.changes()]));
    if (r) exp.variants = r.variants;
    d.note(r ? `Saved ${editor.changes().length} change(s) to ${variant.value}` : "Could not save: only draft experiments can change their variants");
  });
  const addGoal = btn("Add click goal", need(async (el) => {
    if (!goal.value.trim()) return d.note("Name the goal first");
    const text = el.textContent?.trim().slice(0, 100);
    const r = await d.api.addGoal(exp.id, { name: goal.value.trim(), selector: stableSelector(el), ...(text ? { text } : {}), url: location.pathname });
    d.note(r ? `Goal "${goal.value}" added as a secondary metric` : "Could not add the goal");
  }));
  if (!canWrite) {
    for (const b of [save, addGoal]) (b.disabled = true), (b.title = `Requires the ${EXPERIMENT_SCOPE} toolbar scope`);
  }
  root.append(
    mk("b", { textContent: `Experiment: ${exp.name} (${exp.status})` }),
    labelled("Variant", variant),
    labelled("This page only", pageOnly),
    ask("Text", "New text", (el, v) => editor.text(el, v)),
    ask("Style", "CSS as property:value", (el, v) => {
      const [p, ...r] = v.split(":");
      if (p && r.length) editor.style(el, p.trim(), r.join(":").trim());
    }),
    ask("Attribute", "name=value (empty value removes)", (el, v) => {
      const [n, ...r] = v.split("=");
      if (n) editor.attr(el, n.trim(), r.length && r.join("=") !== "" ? r.join("=") : null);
    }),
    btn("Hide", need((el) => editor.hide(el))),
    btn("Move up", need((el) => editor.move(el, -1))),
    btn("Move down", need((el) => editor.move(el, 1))),
    ask("Insert HTML", "position:html, position = before | after | prepend | append (scripts and handlers are removed)", (el, v) => {
      const [pos, ...r] = v.split(":");
      const p = pos?.trim() as InsertPosition;
      if (["before", "after", "prepend", "append"].includes(p) && r.length) editor.insert(el, p, r.join(":"));
      else d.note("Use position:html, for example after:<p>Free shipping</p>");
    }),
    ask("Image URL", "Image URL (https://...)", (el, v) => editor.image(el, v.trim())),
    btn("Upload image", need(() => pickImage.click())),
    pickImage,
    code("Page CSS", "css", ".hero h1 { font-size: 3rem }"),
    code("Page JS", "js", "Runs only after approval and when the site sets visualChanges.allowCustomJs"),
    undo,
    redo,
    labelled("Preview width", device),
    btn("Copy page outline for AI variants", () => {
      const o = JSON.stringify(pageOutline());
      void navigator.clipboard?.writeText(o).then(
        () => d.note("Page outline copied: paste it under Generate variants with AI in the experiment page"),
        () => d.note(o),
      );
    }),
    list,
    save,
    labelled("Goal", goal),
    addGoal,
  );
  // When the toolbar removes the panel: drop the key binding, the listener and the preview frame.
  new MutationObserver((_, o) => {
    if (root.isConnected) root.dataset.mounted = "1";
    else if (root.dataset.mounted) (offKeys(), preview.close(), offChange(), o.disconnect());
  }).observe(document.body, { childList: true, subtree: true });
  load();
  return root;
}

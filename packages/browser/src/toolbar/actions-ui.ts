import type { ActionStep, SavedAction, ToolbarApi } from "./api.js";
import { btn, el, input, labelled, pageBox, select } from "./dom.js";
import { stableSelector } from "./guide-draft.js";
import { captureElement } from "./screenshot.js";

const MAX_TEXT = 100;

/** The step a picked element suggests: stable selector, its short text, the link it sits in, this page. */
export function stepFromElement(target: Element, attrs: readonly string[], path = location.pathname): ActionStep {
  const text = target.textContent?.trim().replace(/\s+/g, " ") ?? "";
  const href = target.closest("a")?.getAttribute("href");
  return {
    selector: stableSelector(target, attrs),
    ...(text && text.length <= MAX_TEXT ? { text, text_match: "exact" as const } : {}),
    ...(href ? { href, href_match: "exact" as const } : {}),
    url: path,
    url_match: "contains",
  };
}

const matchStr = (v: string | null | undefined, want: string | undefined, how: "exact" | "contains" = "exact"): boolean =>
  want === undefined || (v != null && (how === "exact" ? v.trim() === want : v.includes(want)));

/** Does the step's page condition hold here (same semantics as the server's `$current_url` filter)? */
export function stepOnPage(s: ActionStep, href = location.href): boolean {
  if (s.url === undefined) return true;
  if (s.url_match === "regex") {
    try {
      return new RegExp(s.url).test(href);
    } catch {
      return false;
    }
  }
  return s.url_match === "exact" ? href === s.url || new URL(href).pathname === s.url : href.includes(s.url);
}

/** Elements on this page that a step matches (selector, then text and href refinements). */
export function stepElements(s: ActionStep, root: ParentNode = document, href = location.href): Element[] {
  if (!stepOnPage(s, href) || (!s.selector && s.text === undefined && s.href === undefined)) return [];
  let found: Element[];
  try {
    found = Array.from(root.querySelectorAll(s.selector ?? (s.href !== undefined ? "a" : "*")));
  } catch {
    return [];
  }
  return found.filter(
    (e) => !e.closest("[data-lc-ignore]") && matchStr(e.textContent, s.text, s.text_match) && matchStr(e.closest("a")?.getAttribute("href"), s.href, s.href_match),
  );
}

interface Opts {
  api: ToolbarApi;
  attrs: readonly string[];
  picked: () => Element | undefined;
  note: (t: string) => void;
}

/**
 * Action builder: one fieldset per element alternative (OR), each with editable selector, text, link and page
 * conditions; plus the existing-actions overlay (numbered boxes on matched elements, per-action counts, edit, delete).
 */
export function actionsPanel(o: Opts): { node: HTMLElement; teardown: () => void; addStep: (s: ActionStep) => void } {
  const node = el("div");
  const name = input("", "Action name");
  const stepsBox = el("div");
  let steps: ActionStep[] = [];
  let editing: string | undefined;
  // the element the first step was picked from: its screenshot goes with the action
  let shotOf: Element | undefined;
  let boxes: HTMLElement[] = [];
  const list = el("div");

  const field = (s: ActionStep, key: "selector" | "text" | "href" | "url", label: string): HTMLLabelElement => {
    const i = input(s[key] ?? "");
    i.oninput = () => {
      if (i.value) s[key] = i.value;
      else delete s[key];
    };
    return labelled(label, i);
  };
  const how = <K extends "text_match" | "href_match" | "url_match">(s: ActionStep, key: K, label: string, opts: Array<NonNullable<ActionStep[K]>>) => {
    const sel = select(opts.map((v) => [v, v]), (s[key] as string | undefined) ?? opts[0]);
    sel.onchange = () => void (s[key] = sel.value as ActionStep[K]);
    return labelled(label, sel);
  };
  const render = (): void => {
    stepsBox.replaceChildren(
      ...steps.map((s, i) => {
        const f = el("fieldset", undefined, "border:1px solid #444;margin:4px 0;padding:4px");
        f.append(
          el("legend", i === 0 ? "Element 1" : `OR element ${i + 1}`),
          field(s, "selector", "Selector"),
          field(s, "text", "Text"),
          how(s, "text_match", "Text match", ["exact", "contains"]),
          field(s, "href", "Link target"),
          how(s, "href_match", "Link match", ["exact", "contains"]),
          field(s, "url", "Page URL"),
          how(s, "url_match", "Page match", ["contains", "exact", "regex"]),
          btn("Remove element", () => (steps.splice(i, 1), render())),
        );
        return f;
      }),
    );
  };
  const reset = (): void => {
    steps = [];
    editing = undefined;
    shotOf = undefined;
    name.value = "";
    render();
  };
  const clearBoxes = (): void => {
    for (const b of boxes) b.remove();
    boxes = [];
  };
  const showExisting = async (): Promise<void> => {
    clearBoxes();
    const actions = await o.api.listActions();
    let n = 0;
    list.replaceChildren(
      ...actions.map((a: SavedAction) => {
        const matched = [...new Set((Array.isArray(a.steps) ? a.steps : []).flatMap((s) => stepElements(s)))];
        for (const m of matched) {
          n += 1;
          const b = pageBox(m.getBoundingClientRect(), `${n} ${a.name}`, "#fc4");
          document.body.append(b);
          boxes.push(b);
        }
        const row = el("div", `${a.name} (${matched.length} on this page)`, "margin:2px 0");
        row.append(
          btn("Edit", () => {
            editing = a.id;
            name.value = a.name;
            steps = (a.steps ?? []).map((s) => ({ ...s }));
            render();
            o.note(`Editing ${a.name}`);
          }),
          btn("Delete", async () => {
            if (!window.confirm(`Delete action ${a.name}?`)) return;
            o.note((await o.api.deleteAction(a.id)) ? `Deleted ${a.name}` : "Could not delete");
            void showExisting();
          }),
        );
        return row;
      }),
    );
    list.prepend(el("b", `${n} matched element${n === 1 ? "" : "s"} on this page`));
  };

  node.append(
    el("b", "Actions"),
    labelled("Name", name),
    btn("Add picked element", () => {
      const p = o.picked();
      if (!p) return o.note("Inspect an element first");
      steps.push(stepFromElement(p, o.attrs));
      shotOf ??= p;
      render();
    }),
    stepsBox,
    btn("Save action", async () => {
      if (!name.value.trim() || !steps.length) return o.note("Name the action and add at least one element");
      const draft = { name: name.value.trim(), steps };
      const r = editing ? await o.api.updateAction(editing, draft) : await o.api.createAction(draft);
      o.note(r ? `Action ${r.name ?? draft.name} saved` : "Could not save the action");
      if (r && shotOf) {
        const png = await captureElement(shotOf);
        if (png && !(await o.api.putActionScreenshot(r.id, png))) o.note(`Action ${r.name ?? draft.name} saved, screenshot not stored`);
      }
      if (r) reset();
    }),
    btn("New action", reset),
    btn("Show existing actions", () => void showExisting()),
    btn("Hide action boxes", () => (clearBoxes(), list.replaceChildren())),
    list,
  );
  // the heatmap panel prefills a step from one of its element boxes
  const addStep = (s: ActionStep): void => {
    steps.push(s);
    render();
  };
  return { node, teardown: clearBoxes, addStep };
}

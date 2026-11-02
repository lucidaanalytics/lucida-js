import { cssSelector, readSnapshot } from "../autocapture/index.js";
import type { SnapshotRule } from "../autocapture/index.js";
import type { Host } from "../types.js";
import { toolbarHost } from "./api.js";
import type { ToolbarSession } from "./api.js";
import { btn, el, input, labelled, select } from "./dom.js";

/**
 * Snapshot-property picker (P-M15): turn the inspected element into a rule that copies its text or one
 * attribute onto clicks and/or pageviews (POST /snapshot-properties, `actions:write`). Form fields are refused
 * here as on the server; the preview shows what the SDK would read on this page.
 */
const FORM = new Set(["input", "textarea", "select", "option"]);

export interface SnapshotPickerOptions {
  host: Host;
  session: ToolbarSession;
  picked: () => Element | undefined;
  note: (t: string) => void;
}

/** The rule the form describes, or a reason it cannot be saved. */
export function draftRule(
  target: Element | undefined,
  f: { name: string; source: string; attribute: string; click: boolean; pageview: boolean; scope: string },
): SnapshotRule | string {
  if (!target) return "Inspect an element first";
  if (FORM.has(target.tagName.toLowerCase())) return "Form fields are never captured: pick a label or container";
  const name = f.name.trim();
  if (!name || name.startsWith("$")) return "Give the property a name (no leading $)";
  const events = [...(f.click ? ["click" as const] : []), ...(f.pageview ? ["pageview" as const] : [])];
  if (!events.length) return "Pick click and/or pageview";
  const attribute = f.attribute.trim().toLowerCase();
  if (f.source === "attribute" && (!attribute || attribute === "value" || attribute.startsWith("on"))) return "That attribute cannot be captured";
  const scope = f.scope === "target" && !f.pageview ? "target" : "page";
  return {
    name,
    selector: cssSelector(target),
    source: f.source === "attribute" ? "attribute" : "text",
    ...(f.source === "attribute" ? { attribute } : {}),
    events,
    ...(scope === "target" ? { scope } : {}),
  };
}

export function snapshotPicker(o: SnapshotPickerOptions): { node: HTMLElement; teardown: () => void } {
  const base = `${toolbarHost(o.host)}/v1/projects/${encodeURIComponent(o.session.project_id)}/snapshot-properties`;
  const call = async (init: RequestInit = {}): Promise<{ data: SnapshotRule[] } | null> => {
    try {
      const r = await o.host.fetch(base, {
        ...init,
        credentials: "omit",
        headers: { Authorization: `Bearer ${o.session.session_token}`, "Content-Type": "application/json" },
      });
      return r.ok ? ((await r.json()) as { data: SnapshotRule[] }) : null;
    } catch {
      return null;
    }
  };
  const node = el("div", undefined, "border-top:1px solid #333;margin-top:4px;padding-top:4px");
  const name = input("", "property name");
  const source = select([["text", "Visible text"], ["attribute", "Attribute"]], "text");
  const attribute = input("", "data-plan");
  const scope = select([["page", "First match on the page"], ["target", "Around the clicked element"]], "page");
  const click = Object.assign(el("input"), { type: "checkbox", checked: true });
  const pageview = Object.assign(el("input"), { type: "checkbox", checked: false });
  const preview = el("div", undefined, "white-space:pre-wrap;color:#9cf");
  const list = el("ul", undefined, "margin:4px 0;padding-left:16px");
  const form = () => ({ name: name.value, source: source.value, attribute: attribute.value, click: click.checked, pageview: pageview.checked, scope: scope.value });
  const render = (rules: SnapshotRule[]): void => {
    list.replaceChildren(...rules.map((r) => el("li", `${r.name}: ${r.source === "attribute" ? `[${r.attribute}] of ` : ""}${r.selector} (${r.events.join(", ")})`)));
  };
  const show = (): void => {
    const d = draftRule(o.picked(), form());
    if (typeof d === "string") return void (preview.textContent = d);
    const v = readSnapshot([{ ...d, scope: "page" }], d.events[0]!);
    preview.textContent = `${d.selector}\n${d.name} = ${JSON.stringify(v[d.name] ?? null)}`;
  };
  for (const c of [name, source, attribute, scope, click, pageview]) c.addEventListener("input", show);
  node.append(
    el("b", "Snapshot properties"),
    btn("Use inspected element", show),
    labelled("Name", name),
    labelled("Read", source),
    labelled("Attribute", attribute),
    labelled("Element", scope),
    labelled("On clicks", click),
    labelled("On pageviews", pageview),
    preview,
    btn("Save snapshot property", async () => {
      const d = draftRule(o.picked(), form());
      if (typeof d === "string") return o.note(d);
      const r = await call({ method: "POST", body: JSON.stringify(d) });
      if (!r) return o.note("Saving failed (needs toolbar write access)");
      render(r.data);
      o.note(`Saved snapshot property ${d.name}; SDKs pick it up with the next config refresh`);
    }),
    list,
  );
  void call().then((r) => r && render(r.data));
  return { node, teardown: () => node.remove() };
}

import type { ToolbarApi } from "./api.js";
import { recordClicks, recordedToDraft, type GuideDraft, type RecordedStep } from "./guide-draft.js";
import { deriveTheme } from "./theme-derive.js";

// Guide builder extras: record mode and prompt-to-guide (N-DAP-8, through POST /guides/draft) and "derive theme
// from this page" (N-DAP-9, POST /guide-themes). Drafts are never saved here: they load into the builder.

export interface ToolsDeps {
  api: ToolbarApi;
  canWrite: boolean;
  note(t: string): void;
  /** Load a draft into the builder for editing. */
  load(d: GuideDraft): void;
  attrs?: readonly string[];
}

const REC_KEY = "lc_toolbar_recording";

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), props);
const btn = (label: string, on: () => void): HTMLButtonElement => {
  const b = mk("button", { textContent: label, type: "button" });
  b.style.cssText = "margin:2px;padding:4px 8px;font:12px system-ui;cursor:pointer";
  b.onclick = on;
  return b;
};

/** Ask the draft route; fall back to a plain recorded tour when it fails (and there are recorded steps). */
export async function requestDraft(api: ToolbarApi, req: { prompt?: string; recorded_steps?: RecordedStep[] }): Promise<GuideDraft | null> {
  const r = await api.draftGuide(req);
  if (r && Array.isArray(r.steps)) return { name: r.name, kind: r.kind, steps: r.steps, ...(r.targeting ? { targeting: r.targeting } : {}) };
  return req.recorded_steps?.length ? recordedToDraft(req.recorded_steps) : null;
}

export function guideTools(d: ToolsDeps): { node: HTMLElement; teardown: () => void } {
  const root = mk("div");
  // a recording survives full page loads in this tab (sessionStorage), so step urls can span pages
  const saved = (): RecordedStep[] | null => {
    try {
      return JSON.parse(sessionStorage.getItem(REC_KEY) ?? "null") as RecordedStep[] | null;
    } catch {
      return null;
    }
  };
  const persist = (v: RecordedStep[] | null): void => {
    try {
      if (v) sessionStorage.setItem(REC_KEY, JSON.stringify(v));
      else sessionStorage.removeItem(REC_KEY);
    } catch {
      /* storage blocked: the recording lasts for this page only */
    }
  };
  let rec: RecordedStep[] = [];
  let stopRec: (() => void) | undefined;
  const status = mk("div");
  const begin = (from: RecordedStep[]): void => {
    rec = from;
    persist(rec);
    stopRec = recordClicks((s) => {
      if (!root.isConnected) return void (stopRec?.(), (stopRec = undefined)); // the builder was closed
      rec.push(s);
      persist(rec);
      status.textContent = `Recording: ${rec.length} step${rec.length === 1 ? "" : "s"} (${s.selector})`;
    }, d.attrs, 30 - from.length);
    record.textContent = "Stop and draft";
  };
  const record: HTMLButtonElement = btn("Record clicks", async () => {
    if (!stopRec) {
      begin([]);
      return d.note("Click through the flow; each click becomes a tour step");
    }
    stopRec();
    stopRec = undefined;
    persist(null);
    record.textContent = "Record clicks";
    if (!rec.length) return d.note("Nothing recorded");
    d.note("Drafting copy...");
    const draft = await requestDraft(d.api, { recorded_steps: rec });
    if (draft) (d.load(draft), d.note(`Draft with ${draft.steps.length} steps loaded; review, then save`));
  });
  const resumed = saved();
  if (resumed && d.canWrite) begin(resumed);
  const fromPrompt = btn("Draft from prompt", async () => {
    const prompt = window.prompt("Describe the guide (who, what, where)");
    if (!prompt?.trim()) return;
    d.note("Drafting...");
    const draft = await requestDraft(d.api, { prompt: prompt.trim().slice(0, 2000) });
    if (draft) (d.load(draft), d.note("Draft loaded; review, then save"));
    else d.note("Could not draft a guide right now");
  });
  const theme = btn("Derive theme from this page", async () => {
    const t = deriveTheme();
    const summary = JSON.stringify({ tokens: t.tokens, font_family: t.font_family });
    if (!d.canWrite) return d.note(`Derived ${summary}. Saving themes requires the guides:write scope.`);
    const name = window.prompt("Theme name", t.name);
    if (!name?.trim()) return;
    const saved = await d.api.createTheme({ name: name.trim().slice(0, 100), tokens: t.tokens, ...(t.font_family ? { font_family: t.font_family } : {}), ...(t.radius !== undefined ? { radius: t.radius } : {}) });
    d.note(saved ? `Theme "${saved.name}" saved (${saved.id}): pick it in a guide's appearance` : `Could not save the theme. Derived ${summary}`);
  });
  if (!d.canWrite) {
    for (const b of [record, fromPrompt]) {
      b.disabled = true;
      b.title = "Requires the guides:write toolbar scope";
    }
  }
  root.append(mk("b", { textContent: "AI and themes" }), mk("br"), record, fromPrompt, theme, status);
  return { node: root, teardown: () => stopRec?.() };
}

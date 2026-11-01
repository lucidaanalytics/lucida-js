import type { WireEvent } from "@lucida/sdk-core";
import type { Host } from "../types.js";
import { btn, el, input, labelled, select } from "./dom.js";

const MAX = 500;
const REPLAY = new Set(["$snapshot", "$replay_tag", "$rageclick", "$deadclick", "$heatmap_moves", "$attention"]);

export type Category = "all" | "custom" | "system" | "replay";

export const categoryOf = (event: string): Exclude<Category, "all"> =>
  REPLAY.has(event) ? "replay" : event.startsWith("$") ? "system" : "custom";

/** `/re/flags` is a regular expression (invalid ones match nothing); anything else a case-insensitive substring. */
export function matcher(q: string): (s: string) => boolean {
  const m = /^\/(.+)\/([a-z]*)$/.exec(q.trim());
  if (m) {
    try {
      const re = new RegExp(m[1] as string, m[2]);
      return (s) => re.test(s);
    } catch {
      return () => false;
    }
  }
  const n = q.trim().toLowerCase();
  return (s) => !n || s.toLowerCase().includes(n);
}

interface Row {
  e: WireEvent;
  at: number;
  pinned: boolean;
}

/**
 * Event debugger: the events this page captures (after the consent gate), newest first. Search by substring or
 * `/regex/` over name and payload, filter by category, pause (new events buffer), pin, copy, clear, export JSON and
 * switch between absolute and relative times. Local only: nothing is sent anywhere.
 */
export function eventDebugger(host: Host): { node: HTMLElement; teardown: () => void } {
  const node = el("div");
  const q = input("", "name, payload or /regex/");
  const cat = select([
    ["all", "All events"],
    ["custom", "Custom"],
    ["system", "System ($)"],
    ["replay", "Replay and heatmap"],
  ]);
  const paused = Object.assign(el("input"), { type: "checkbox" });
  const relative = Object.assign(el("input"), { type: "checkbox" });
  const status = el("div");
  const list = el("div", undefined, "max-height:240px;overflow:auto");
  let rows: Row[] = [];
  let held: Row[] = [];
  let alive = true;
  const t0 = Date.now();

  const render = (): void => {
    const hit = matcher(q.value);
    const shown = rows
      .filter((r) => r.pinned || ((cat.value === "all" || categoryOf(r.e.event) === cat.value) && hit(`${r.e.event} ${JSON.stringify(r.e.properties ?? {})}`)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at);
    status.textContent = `${shown.length} of ${rows.length} events${held.length ? `, ${held.length} held while paused` : ""}`;
    list.replaceChildren(
      ...shown.map((r) => {
        const d = el("details", undefined, "border-top:1px solid #333;padding:2px 0");
        const when = relative.checked ? `+${((r.at - t0) / 1000).toFixed(1)}s` : new Date(r.at).toLocaleTimeString();
        const sum = el("summary", `${r.pinned ? "[pinned] " : ""}${when} ${r.e.event}`);
        const json = JSON.stringify(r.e, null, 1);
        d.append(
          sum,
          btn(r.pinned ? "Unpin" : "Pin", () => ((r.pinned = !r.pinned), render())),
          btn("Copy", () => void navigator.clipboard?.writeText(json)),
          el("pre", json, "white-space:pre-wrap;max-height:160px;overflow:auto;margin:0"),
        );
        return d;
      }),
    );
  };
  host.onCapture((e) => {
    if (!alive) return;
    const r = { e, at: Date.now(), pinned: false };
    if (paused.checked) held.push(r);
    else rows.push(r);
    if (rows.length > MAX) rows = rows.filter((x, i) => x.pinned || i >= rows.length - MAX);
    render();
  });
  paused.onchange = () => {
    if (!paused.checked) rows.push(...held.splice(0));
    render();
  };
  q.oninput = cat.onchange = relative.onchange = render;
  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(rows.map((r) => r.e), null, 1)], { type: "application/json" });
    const a = Object.assign(el("a"), { href: URL.createObjectURL(blob), download: `lucida-events-${t0}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  node.append(
    el("b", "Event debugger"),
    labelled("Search", q),
    labelled("Category", cat),
    labelled("Pause", paused),
    labelled("Relative time", relative),
    btn("Clear", () => ((rows = rows.filter((r) => r.pinned)), (held = []), render())),
    btn("Export JSON", exportJson),
    status,
    list,
  );
  render();
  return { node, teardown: () => void (alive = false) };
}

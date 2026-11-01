import type { FlagValue, Host } from "../types.js";
import type { ToolbarApi, ToolbarFlag } from "./api.js";
import { getFlagOverrides, setFlagOverride } from "./api.js";
import { btn, el, input, labelled, select } from "./dom.js";

const DEFAULT = "__default";

/** The values a flag can be forced to: on/off for boolean flags, each variant key for multivariate ones. */
export function overrideChoices(f: ToolbarFlag | undefined, current: FlagValue | undefined): Array<[string, string]> {
  const vs = f?.variants?.map((v) => v.key) ?? [];
  const values = vs.length ? vs : typeof current === "string" ? [current] : [];
  return [[DEFAULT, "(no override)"], ["true", "on"], ["false", "off"], ...values.map((v): [string, string] => [`v:${v}`, v])];
}

const encode = (v: FlagValue | undefined): string => (v === undefined ? DEFAULT : typeof v === "boolean" ? String(v) : `v:${v}`);
const decode = (s: string): FlagValue | null => (s === DEFAULT ? null : s === "true" ? true : s === "false" ? false : s.slice(2));

/** Per-browser flag overrides: search, a value picker per flag (variants included) and a reload prompt. */
export function flagsPanel(host: Host, api: ToolbarApi): { node: HTMLElement; teardown: () => void } {
  const node = el("div");
  const search = input("", "Search flags");
  const list = el("div");
  const reload = el("div");
  let live: Record<string, FlagValue> = {};
  let defs: ToolbarFlag[] = [];
  const render = (): void => {
    const ov = getFlagOverrides();
    const q = search.value.trim().toLowerCase();
    const keys = [...new Set([...defs.map((d) => d.key), ...Object.keys(live)])].filter((k) => !q || k.toLowerCase().includes(q)).sort();
    list.replaceChildren(
      ...keys.map((k) => {
        const s = select(overrideChoices(defs.find((d) => d.key === k), ov[k] ?? live[k]), encode(ov[k]));
        s.onchange = () => {
          setFlagOverride(k, decode(s.value));
          reload.replaceChildren(el("span", "Overrides apply on the next page load. "), btn("Reload now", () => location.reload()));
          render();
        };
        const row = labelled(`${k} = ${String(ov[k] ?? live[k] ?? "-")}${k in ov ? " (override)" : ""}`, s);
        return row;
      }),
    );
    if (!keys.length) list.append(el("div", q ? "No flag matches" : "No flags"));
  };
  search.oninput = render;
  const stop = host.client.onFlags((f) => {
    live = f;
    render();
  });
  void api.flags().then((d) => {
    defs = d;
    render();
  });
  node.append(el("b", "Feature flags (this browser)"), labelled("Search", search), list, reload);
  return { node, teardown: stop };
}

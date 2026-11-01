import { viewportBucket } from "../heatmaps/index.js";
import type { HeatBins, HeatElement, HeatType, ScrollReach, ToolbarApi } from "./api.js";
import { btn, el, labelled, pageBox, select } from "./dom.js";

const docSize = () => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight });

/** The page path the server bins by (lc_replay::normalize_url: no query, no trailing slash). */
export const pagePath = (p = location.pathname): string => (p.length > 1 ? p.replace(/\/+$/, "") || "/" : "/");

/** Binned points as a heat layer over the whole document: cell (x, y) covers 1/x_bins of the width and y_bin_px rows. */
export function drawHeat(d: HeatBins): HTMLCanvasElement {
  const { w, h } = docSize();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.setAttribute("data-lc-ignore", "");
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", `Heatmap of ${d.total} events`);
  c.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;z-index:2147483645;opacity:.75`;
  const g = c.getContext("2d");
  if (!g) return c;
  // x was recorded as a share of the viewport width
  const cw = (document.documentElement.clientWidth || w) / Math.max(1, d.x_bins);
  for (const b of d.bins) {
    const t = d.max > 0 ? b.count / d.max : 0;
    g.fillStyle = `hsla(${Math.round((1 - t) * 55)}, 95%, 52%, ${(0.25 + 0.55 * t).toFixed(2)})`;
    g.fillRect(b.x * cw, b.y * d.y_bin_px, cw, d.y_bin_px);
  }
  return c;
}

/** Scrollmap: one band per 10% of the page, shaded and labelled with the share of sessions that reached it. */
export function drawScroll(r: ScrollReach): HTMLDivElement {
  const { h } = docSize();
  const wrap = el("div", undefined, `position:absolute;left:0;top:0;width:100%;height:${h}px;pointer-events:none;z-index:2147483645`);
  wrap.setAttribute("data-lc-ignore", "");
  for (const band of r.reach) {
    const share = r.sessions > 0 ? band.sessions / r.sessions : 0;
    const d = el(
      "div",
      `${Math.round(share * 100)}% reached`,
      `position:absolute;left:0;width:100%;top:${((band.depth_pct - 10) / 100) * h}px;height:${h / 10}px;` +
        `background:hsla(${Math.round(share * 120)},80%,50%,.25);font:bold 11px system-ui;color:#000;padding:2px`,
    );
    wrap.append(d);
  }
  return wrap;
}

/** Elements a click-rank row names: a selector, or with `byHref` the links that go there. */
export function rowElements(row: HeatElement, byHref: boolean): Element[] {
  try {
    const found = byHref
      ? Array.from(document.querySelectorAll("a[href]")).filter((a) => a.getAttribute("href") === row.selector)
      : Array.from(document.querySelectorAll(row.selector));
    return found.filter((e) => !e.closest("[data-lc-ignore]"));
  } catch {
    return []; // a recorded selector this browser cannot parse
  }
}

interface Opts {
  api: ToolbarApi;
  note: (t: string) => void;
  /** "Create action" on a box: the element it marks. */
  onPick: (e: Element) => void;
}

/**
 * Toolbar heatmap parity: type switch (click, rage, dead, move, scroll), click-rank boxes numbered on the page with
 * clicks and rage counts (click one to start an action from it), "Load more" / "Load all" paging and link matching.
 */
export function heatPanel(o: Opts): { node: HTMLElement; teardown: () => void } {
  const node = el("div");
  const type = select([
    ["click", "Clicks"],
    ["rage", "Rage clicks"],
    ["dead", "Dead clicks"],
    ["move", "Mouse movement"],
    ["scroll", "Scrollmap"],
  ]);
  const byHref = Object.assign(el("input"), { type: "checkbox" });
  const list = el("div", undefined, "white-space:pre-wrap");
  let layer: HTMLElement | undefined;
  let boxes: HTMLElement[] = [];
  let cursor: string | null = null;
  let rows: HeatElement[] = [];
  const clear = (): void => {
    layer?.remove();
    layer = undefined;
    for (const b of boxes) b.remove();
    boxes = [];
    rows = [];
    cursor = null;
    list.replaceChildren();
  };
  const vp = () => viewportBucket(window.innerWidth);
  const drawBoxes = (): void => {
    for (const b of boxes) b.remove();
    boxes = [];
    list.replaceChildren();
    rows.forEach((r, i) => {
      const label = `${i + 1}: ${r.clicks} clicks${r.rage_clicks ? `, ${r.rage_clicks} rage` : ""}`;
      const found = rowElements(r, byHref.checked);
      for (const e of found) {
        const b = pageBox(e.getBoundingClientRect(), label, r.rage_clicks ? "#f55" : "#4af");
        document.body.append(b);
        boxes.push(b);
      }
      const line = el("div", `${label} ${r.selector}${found.length ? "" : " (not on this page)"}`);
      if (found[0]) line.append(btn("Create action", () => o.onPick(found[0] as Element)));
      list.append(line);
    });
  };
  const more = async (all: boolean): Promise<void> => {
    do {
      const page = await o.api.elements(pagePath(), vp(), cursor, byHref.checked);
      if (!page) return o.note("Could not load elements");
      rows.push(...page.data);
      cursor = page.next_cursor;
    } while (all && cursor);
    drawBoxes();
    moreBtns.style.display = cursor ? "" : "none";
  };
  const show = async (): Promise<void> => {
    clear();
    const t = type.value as HeatType;
    if (t === "scroll") {
      const r = await o.api.scroll(pagePath(), vp());
      if (!r) return o.note("No scroll data");
      layer = drawScroll(r);
    } else {
      const d = await o.api.heat(pagePath(), vp(), t);
      if (!d) return o.note("No heatmap data");
      layer = drawHeat(d);
      o.note(`${d.total} ${t} events on ${pagePath()} (${vp()})`);
      if (t === "click" || t === "rage" || t === "dead") await more(false);
    }
    document.body.append(layer);
  };
  const moreBtns = el("span");
  moreBtns.style.display = "none";
  moreBtns.append(btn("Load more", () => void more(false)), btn("Load all", () => void more(true)));
  node.append(
    el("b", "Heatmap"),
    labelled("Heatmap type", type),
    labelled("Match links by URL", byHref),
    btn("Show heatmap", () => void show()),
    btn("Hide heatmap", clear),
    moreBtns,
    list,
  );
  return { node, teardown: clear };
}

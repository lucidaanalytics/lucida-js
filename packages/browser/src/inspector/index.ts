import type { WireEvent } from "@lucida-analytics/sdk-core";
import type { Module } from "../types.js";

const MAX_ROWS = 100;

/** Pure formatter, exported for tests. */
export function describeEvent(e: WireEvent): string {
  const t = e.timestamp.slice(11, 23);
  return `${t}  ${e.event}`;
}

/**
 * Local event inspector (LC-DX-6): a shadow-DOM overlay listing every event the SDK captures
 * with its properties, plus consent state and current flags. Shown with `?__lc_debug=1` (or
 * `debug: true`). Nothing leaves the page; the overlay is invisible to capture (data-lc-ignore).
 */
export const inspector: Module = (host) => {
  const on = host.config.debug || /[?&]__lc_debug=1/.test(location.search);
  if (!on) return;
  const root = document.createElement("div");
  root.setAttribute("data-lc-ignore", "");
  root.style.cssText = "position:fixed;top:8px;right:8px;z-index:2147483647";
  const sh = root.attachShadow({ mode: "open" });
  const box = document.createElement("div");
  box.style.cssText =
    "background:#0b0b0b;color:#ddd;font:11px ui-monospace,monospace;width:340px;max-height:50vh;overflow:auto;padding:6px;border-radius:6px";
  const head = document.createElement("div");
  const flagsEl = document.createElement("div");
  const list = document.createElement("div");
  box.append(head, flagsEl, list);
  sh.append(box);

  const renderHead = (): void => {
    const c = host.core.getConsent();
    head.textContent = `Lucida inspector | distinct_id ${host.core.distinctId} | consent a:${+c.analytics} r:${+c.replay} m:${+c.marketing}`;
  };
  renderHead();
  host.core.onChange(renderHead);
  const stopFlags = host.client.onFlags((f) => (flagsEl.textContent = `flags ${JSON.stringify(f)}`));

  host.onCapture((e) => {
    const row = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = describeEvent(e);
    const pre = document.createElement("pre");
    pre.style.cssText = "white-space:pre-wrap;margin:2px 0";
    pre.textContent = JSON.stringify(e.properties, null, 1);
    row.append(sum, pre);
    list.prepend(row);
    while (list.childElementCount > MAX_ROWS) list.lastElementChild?.remove();
  });
  document.body.append(root);
  return () => {
    stopFlags();
    root.remove();
  };
};

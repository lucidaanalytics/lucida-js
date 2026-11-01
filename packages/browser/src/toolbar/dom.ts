/** Tiny DOM helpers shared by the toolbar panels (everything renders inside the toolbar's shadow root). */

export const btn = (label: string, on: () => void, title?: string): HTMLButtonElement => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (title) b.title = title;
  b.style.cssText = "margin:2px;padding:4px 8px;font:12px system-ui;cursor:pointer";
  b.onclick = on;
  return b;
};

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, css?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (css) e.style.cssText = css;
  return e;
};

/** `<label>text <control></label>`: every toolbar input has an accessible name. */
export const labelled = <C extends HTMLElement>(text: string, control: C): HTMLLabelElement => {
  const l = el("label", undefined, "display:block;margin:2px 0");
  l.append(`${text} `, control);
  return l;
};

export const input = (value = "", placeholder = ""): HTMLInputElement => {
  const i = el("input", undefined, "font:12px system-ui;width:150px");
  i.value = value;
  i.placeholder = placeholder;
  return i;
};

export const select = (options: Array<[value: string, label: string]>, value?: string): HTMLSelectElement => {
  const s = el("select", undefined, "font:12px system-ui");
  for (const [v, t] of options) s.append(Object.assign(el("option", t), { value: v }));
  if (value !== undefined) s.value = value;
  return s;
};

/** A fixed, click-through box over `r` (viewport coordinates) on the page, outside the shadow root. */
export function pageBox(r: DOMRect, label: string, color = "#4af"): HTMLDivElement {
  const d = el(
    "div",
    undefined,
    `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;` +
      `border:2px solid ${color};box-sizing:border-box;z-index:2147483646;pointer-events:none`,
  );
  d.setAttribute("data-lc-ignore", "");
  const tag = el("span", label, `position:absolute;left:-2px;top:-18px;background:${color};color:#000;font:bold 11px system-ui;padding:1px 4px;border-radius:3px;white-space:nowrap`);
  d.append(tag);
  return d;
}

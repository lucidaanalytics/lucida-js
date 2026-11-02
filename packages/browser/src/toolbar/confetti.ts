import type { Confetti } from "./api.js";
import { el } from "./dom.js";

/** Twelve distinct hues (the API's legend size), then grey for `(other)`; same palette as the web heatmap page. */
const COLOURS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#3b4cc0", "#f4a582", "#006d2c"];
export const confettiColour = (i: number, legend: Confetti["legend"]): string =>
  legend[i]?.value === "(other)" ? "#9e9e9e" : (COLOURS[i % COLOURS.length] ?? "#9e9e9e");

/** "Colour by" choices: the `breakdown` values GET /heatmaps/confetti accepts ("" = plain heat). */
export const BREAKDOWNS: Array<[value: string, label: string]> = [
  ["", "Heat (no breakdown)"],
  ["channel", "Channel"],
  ["referrer", "Referrer"],
  ["device", "Device"],
  ["country", "Country"],
  ["browser", "Browser"],
  ["os", "OS"],
  ["visitor", "New vs returning"],
  ["event", "Event property"],
  ["person", "Person property"],
];

/** The `breakdown` query value, or "" when nothing complete is picked. */
export function breakdownParam(by: string, key: string): string {
  if (by === "event" || by === "person") return key.trim() ? `${by}:${key.trim()}` : "";
  return by;
}

/** Click dots over the whole document, coloured by legend entry; `hidden` holds legend indexes switched off. */
export function drawConfetti(d: Confetti, hidden: ReadonlySet<number>, c = document.createElement("canvas")): HTMLCanvasElement {
  const w = document.documentElement.scrollWidth;
  const h = Math.max(document.documentElement.scrollHeight, ...d.dots.map((p) => p[1] + 4));
  c.width = w;
  c.height = h;
  c.setAttribute("data-lc-ignore", "");
  c.setAttribute("role", "img");
  c.setAttribute("aria-label", `Confetti of ${d.dots.length} clicks`);
  c.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;z-index:2147483645`;
  const g = c.getContext("2d");
  if (!g) return c;
  // x was recorded as a share of the viewport width, y in page px
  const vw = document.documentElement.clientWidth || w;
  for (const [x, y, i] of d.dots) {
    if (hidden.has(i)) continue;
    g.fillStyle = confettiColour(i, d.legend);
    g.beginPath();
    g.arc(x * vw, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Legend whose checkboxes switch their dots on and off. */
export function confettiLegend(d: Confetti, hidden: Set<number>, onToggle: () => void): HTMLElement {
  if (d.legend.length === 0) return el("div", "No clicks in this range.");
  const list = el("ul", undefined, "list-style:none;margin:4px 0;padding:0");
  list.setAttribute("aria-label", "Confetti legend");
  d.legend.forEach((l, i) => {
    const box = Object.assign(el("input"), { type: "checkbox", checked: !hidden.has(i) });
    box.onchange = () => {
      if (box.checked) hidden.delete(i);
      else hidden.add(i);
      onToggle();
    };
    const dot = el("span", undefined, `display:inline-block;width:10px;height:10px;border-radius:5px;margin:0 6px;background:${confettiColour(i, d.legend)}`);
    dot.setAttribute("aria-hidden", "true");
    const label = el("label");
    label.append(box, dot, `${l.value || "(none)"} (${l.clicks})`);
    const li = el("li");
    li.append(label);
    list.append(li);
  });
  return list;
}

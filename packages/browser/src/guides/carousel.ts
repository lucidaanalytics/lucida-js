// Carousel guides (N-DAP-7): an unanchored modal of slides (one step each) with a dot pager, Back / Next,
// arrow keys and swipe. The renderer draws the slide body; this adds the navigation.

export const CAROUSEL_CSS =
  ".cd{display:flex;gap:6px;justify-content:center;margin:8px 0}.cd button{width:10px;height:10px;min-width:0;padding:0;margin:0;border-radius:50%;background:#ccc;border:0}" +
  ".cd button[aria-current=true]{background:var(--a,#111)}.cn{display:flex;justify-content:space-between}";

export interface CarouselNav {
  index: number;
  count: number;
  /** Go to slide i (0-based). */
  to(i: number): void;
  complete(): void;
  dismiss(): void;
}

const button = (label: string, on: () => void, aria?: string): HTMLButtonElement => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (aria) b.setAttribute("aria-label", aria);
  b.onclick = on;
  return b;
};

/** Pager and buttons for slide `n.index`. */
export function carouselControls(n: CarouselNav): HTMLElement {
  const wrap = document.createElement("div");
  const dots = document.createElement("div");
  dots.className = "cd";
  dots.setAttribute("role", "tablist");
  for (let i = 0; i < n.count; i++) {
    const d = button("", () => n.to(i), `Slide ${i + 1} of ${n.count}`);
    d.setAttribute("role", "tab");
    d.setAttribute("aria-current", String(i === n.index));
    dots.append(d);
  }
  const row = document.createElement("div");
  row.className = "cn";
  const last = n.index === n.count - 1;
  row.append(
    n.index > 0 ? button("Back", () => n.to(n.index - 1)) : button("Skip", n.dismiss),
    button(last ? "Done" : "Next", () => (last ? n.complete() : n.to(n.index + 1))),
  );
  wrap.append(dots, row);
  return wrap;
}

/** Arrow keys and horizontal swipes (over 40 px) move between slides. Returns the remover. */
export function carouselGestures(box: HTMLElement, nav: () => CarouselNav): () => void {
  let x0: number | undefined;
  const down = (e: PointerEvent): void => void (x0 = e.clientX);
  const up = (e: PointerEvent): void => {
    if (x0 === undefined) return;
    const dx = e.clientX - x0;
    x0 = undefined;
    const n = nav();
    if (dx < -40 && n.index < n.count - 1) n.to(n.index + 1);
    else if (dx > 40 && n.index > 0) n.to(n.index - 1);
  };
  const key = (e: KeyboardEvent): void => {
    const n = nav();
    if (e.key === "ArrowRight" && n.index < n.count - 1) n.to(n.index + 1);
    else if (e.key === "ArrowLeft" && n.index > 0) n.to(n.index - 1);
  };
  box.addEventListener("pointerdown", down);
  box.addEventListener("pointerup", up);
  box.addEventListener("keydown", key);
  return () => {
    box.removeEventListener("pointerdown", down);
    box.removeEventListener("pointerup", up);
    box.removeEventListener("keydown", key);
  };
}

import { styleTag } from "../csp.js";
import { claim } from "../arbiter.js";
import type { Guide } from "../types.js";
import { renderGuide, type GuideHooks, type RenderOpts } from "./render.js";

// Persistent guide kinds (LC-ENG-10), loaded on demand by the guides module: they stay on the page
// until the person closes them. hotspot = outlined element + pulsing dot, beacon = pulsing dot,
// badge = small label on the element, launcher = floating button that opens a resource-center panel.
const CSS =
  "button{font:13px system-ui;cursor:pointer}.d,.b,.l,.o{position:fixed;z-index:2147482000}" +
  ".d{width:16px;height:16px;padding:0;border-radius:50%;border:2px solid #fff;background:#e5484d;animation:p 1.6s infinite}" +
  ".o{z-index:2147481000;border:2px solid #e5484d;border-radius:6px;pointer-events:none}" +
  ".b{padding:1px 8px;border:0;border-radius:10px;background:#e5484d;color:#fff;font-size:11px}" +
  ".l{right:16px;bottom:16px;padding:10px 16px;border:0;border-radius:24px;background:#111;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.3)}" +
  "@keyframes p{0%{box-shadow:0 0 0 0 rgba(229,72,77,.6)}100%{box-shadow:0 0 0 14px rgba(229,72,77,0)}}" +
  "@media (prefers-reduced-motion:reduce){.d{animation:none}}";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, label?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (label) e.textContent = label; // guide text is data, never markup
  return e;
}

/** Render a hotspot, beacon, badge or launcher. Returns the teardown (which also calls `done`). */
export function renderPersistent(g: Guide, hooks: GuideHooks, done: () => void, opts: RenderOpts = {}): () => void {
  const host = document.createElement("div");
  host.setAttribute("data-lc-ignore", "");
  const root = host.attachShadow({ mode: "open" });
  root.append(styleTag(CSS, opts.nonce));
  const step = g.steps[0]!;
  const label = step.title ?? g.name;
  let open = false;
  let gone = false;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    removeEventListener("scroll", layout, true);
    removeEventListener("resize", layout);
    host.remove();
    done();
  };
  /** Open the content as a normal guide (a tooltip, or the resource-center panel for the launcher). */
  const openPanel = (): void => {
    const release = claim();
    if (!release || open) return release?.();
    open = true;
    const launcher = g.kind === "launcher";
    const inner: GuideHooks = {
      ...hooks,
      shown() {},
      // closing the launcher panel is not a dismissal; closing a hotspot / badge popover is
      dismissed: (i, id) => (launcher ? undefined : ((gone = true), hooks.dismissed(i, id))),
      completed: () => ((gone = !launcher), hooks.completed()),
    };
    renderGuide({ ...g, kind: launcher ? "resource_center" : "tooltip" }, inner, () => {
      open = false;
      release();
      if (gone) stop();
    }, opts);
  };

  const marker = g.kind === "badge" ? node("button", "b", label) : node("button", g.kind === "launcher" ? "l" : "d", g.kind === "launcher" ? (g.appearance?.launcher_label ?? g.name) : undefined);
  marker.type = "button";
  marker.setAttribute("aria-label", g.kind === "launcher" ? String(g.appearance?.launcher_label ?? g.name) : label);
  const outline = g.kind === "hotspot" ? node("div", "o") : undefined;
  marker.onclick = () => {
    if (g.kind === "badge") {
      hooks.dismissed(0, step.id);
      stop();
    } else openPanel();
  };
  root.append(...(outline ? [outline] : []), marker);

  /** Follow the anchor element (it may mount late, move or scroll). */
  function layout(): void {
    if (g.kind === "launcher") return;
    const target = step.selector ? document.querySelector(step.selector) : null;
    marker.hidden = !target;
    if (outline) outline.hidden = !target;
    if (!target) return;
    const r = target.getBoundingClientRect();
    const [x, y] = g.kind === "badge" ? [r.right - marker.offsetWidth / 2, r.top - marker.offsetHeight / 2] : [r.right - 8, r.top - 8];
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    if (outline) Object.assign(outline.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  const timer = setInterval(layout, 500);
  addEventListener("scroll", layout, true);
  addEventListener("resize", layout);
  document.body.append(host);
  layout();
  hooks.shown();
  return stop;
}

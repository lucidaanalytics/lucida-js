import { claim } from "../arbiter.js";
import type { Guide, GuideStep } from "../types.js";
import { findTarget, renderGuide, type GuideHandle, type GuideHooks, type RenderOpts } from "./render.js";
import { runAutomation } from "./step-extras.js";

// Guides in iframes (N-DAP-16). A child frame configured with `guides.renderInTop: "<top origin>"` does not draw
// its guides itself: it posts them to the top window, which draws them over the whole page when its own SDK lists
// the child's origin in `guides.frameOrigins`. The child keeps ownership (targeting, state, events): the top only
// renders and posts each hook back. Target rects are measured in the child and shifted by the iframe's position.
// Messages always go to one exact origin (never "*") and are accepted only from the expected window and origin.
// shortcut: direct child iframes only, and branch rules on element presence are evaluated in the top document;
// upgrade when nested frames or cross-frame branching are needed.

export const FRAME_MSG = "lc:guide";

type Rect = { x: number; y: number; width: number; height: number };
type Msg =
  | { lc: typeof FRAME_MSG; op: "render"; key: string; guide: Guide; start?: number; checked?: string[] }
  | { lc: typeof FRAME_MSG; op: "rects"; key: string; rects: Record<string, Rect | null> }
  | { lc: typeof FRAME_MSG; op: "close" | "closed"; key: string }
  | { lc: typeof FRAME_MSG; op: "mark"; key: string; stepId: string }
  | { lc: typeof FRAME_MSG; op: "hook"; key: string; name: HookName; args: unknown[] };

const HOOKS = ["shown", "step", "completed", "dismissed", "event", "progress", "snoozed", "targetMissing"] as const;
type HookName = (typeof HOOKS)[number];
/** Kinds the top window may draw for a child (persistent, inline and form kinds stay in their own frame). */
export const FORWARDABLE = new Set<Guide["kind"]>(["tooltip", "modal", "banner", "tour", "checklist", "resource_center", "announcement", "slideout", "carousel"]);

const isMsg = (d: unknown): d is Msg => !!d && typeof d === "object" && (d as { lc?: unknown }).lc === FRAME_MSG && typeof (d as { key?: unknown }).key === "string";

const rectOf = (e: Element | null): Rect | null => {
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

/** True when this document is a child frame (cross-origin parents throw on access, which also means framed). */
export function framed(): boolean {
  try {
    return window.top !== window;
  } catch {
    return true;
  }
}

let seq = 0;

/** Child side: draw `g` in the top window at `topOrigin`. Same contract as renderGuide. */
export function forwardGuide(g: Guide, hooks: GuideHooks, done: () => void, opts: RenderOpts, topOrigin: string): GuideHandle {
  const top = window.top;
  const key = `${Date.now().toString(36)}-${++seq}`;
  let closed = false;
  const post = (m: Record<string, unknown>): void => {
    try {
      top?.postMessage({ ...m, lc: FRAME_MSG, key }, topOrigin);
    } catch {
      /* top gone or origin mismatch: nothing is drawn */
    }
  };
  const anchored = g.steps.filter((s) => s.selector || s.fallback_selectors?.length);
  const sendRects = (): void => {
    const rects: Record<string, Rect | null> = {};
    for (const s of anchored) rects[s.id] = rectOf(findTarget(s));
    post({ op: "rects", rects });
  };
  const onMsg = (e: MessageEvent): void => {
    if (e.source !== top || e.origin !== topOrigin || !isMsg(e.data) || e.data.key !== key) return;
    const m = e.data;
    if (m.op === "closed") return stop(false);
    if (m.op !== "hook" || !HOOKS.includes(m.name) || !Array.isArray(m.args)) return;
    const fn = hooks[m.name] as ((...a: unknown[]) => void) | undefined;
    fn?.(...m.args);
    // automations act on this frame's page, never the top's
    if (m.name === "step") {
      const st: GuideStep | undefined = g.steps.find((x) => x.id === m.args[1]);
      if (st?.automation && opts.automate !== false) hooks.automated?.(st.id, runAutomation(st.automation));
    }
  };
  addEventListener("message", onMsg);
  const timer = anchored.length ? setInterval(sendRects, 200) : undefined;
  addEventListener("scroll", sendRects, true);
  addEventListener("resize", sendRects);
  const stop = (notify: boolean): void => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    removeEventListener("message", onMsg);
    removeEventListener("scroll", sendRects, true);
    removeEventListener("resize", sendRects);
    if (notify) post({ op: "close" });
    done();
  };
  post({ op: "render", guide: g, ...(opts.start ? { start: opts.start } : {}), ...(opts.checked ? { checked: opts.checked } : {}) });
  if (anchored.length) sendRects();
  return Object.assign(() => stop(true), { markDone: (stepId: string) => post({ op: "mark", stepId }) });
}

/** The iframe element whose window is `w`, if it is a direct child of this document. */
function frameOf(w: MessageEventSource | null): HTMLIFrameElement | null {
  for (const f of document.querySelectorAll("iframe")) if (f.contentWindow === w) return f;
  return null;
}

/** A stand-in target: only what the renderer uses (rect, and no-op listeners: clicks in the child stay there). */
function proxyTarget(frame: HTMLIFrameElement, r: Rect): Element {
  const at = (): DOMRect => {
    const f = frame.getBoundingClientRect();
    return new DOMRect(f.left + frame.clientLeft + r.x, f.top + frame.clientTop + r.y, r.width, r.height);
  };
  const noop = (): void => {};
  return { getBoundingClientRect: at, addEventListener: noop, removeEventListener: noop } as unknown as Element;
}

/** Top side: draw guides forwarded by child frames of the `allowed` origins. Returns the remover. */
export function listenFrames(allowed: string[], nonce?: string): () => void {
  const ok = new Set(allowed.map((o) => o.replace(/\/+$/, "")));
  const live = new Map<string, { handle: GuideHandle; rects: Record<string, Rect | null>; release: () => void }>();
  const onMsg = (e: MessageEvent): void => {
    if (!ok.has(e.origin) || !isMsg(e.data)) return;
    const frame = frameOf(e.source);
    if (!frame) return;
    const m = e.data;
    const id = `${e.origin}|${m.key}`;
    const back = (x: Record<string, unknown>): void => {
      try {
        (e.source as Window).postMessage({ ...x, lc: FRAME_MSG, key: m.key }, e.origin);
      } catch {
        /* frame navigated away */
      }
    };
    const cur = live.get(id);
    if (m.op === "rects" && cur) cur.rects = m.rects && typeof m.rects === "object" ? m.rects : {};
    else if (m.op === "close") cur?.handle();
    else if (m.op === "mark") cur?.handle.markDone(String(m.stepId));
    else if (m.op === "render" && !cur) {
      const g = m.guide;
      if (!g || typeof g.id !== "string" || typeof g.name !== "string" || !Array.isArray(g.steps) || !FORWARDABLE.has(g.kind)) return;
      const release = g.kind === "banner" ? () => {} : claim();
      if (!release) return back({ op: "closed" }); // the top already shows a guide
      const relay = (name: HookName) => (...args: unknown[]): void => back({ op: "hook", name, args });
      const hooks = Object.fromEntries(HOOKS.map((n) => [n, relay(n)])) as unknown as GuideHooks;
      const entry = { rects: {} as Record<string, Rect | null>, release, handle: undefined as unknown as GuideHandle };
      live.set(id, entry);
      const resolveTarget = (s: GuideStep): Element | null => {
        const r = entry.rects[s.id];
        return r && typeof r.x === "number" ? proxyTarget(frame, r) : null;
      };
      const opts: RenderOpts = { resolveTarget, automate: false, ...(nonce ? { nonce } : {}), ...(typeof m.start === "number" ? { start: m.start } : {}), ...(Array.isArray(m.checked) ? { checked: m.checked } : {}) };
      entry.handle = renderGuide(g, hooks, () => {
        live.delete(id);
        release();
        back({ op: "closed" });
      }, opts);
    }
  };
  addEventListener("message", onMsg);
  return () => {
    removeEventListener("message", onMsg);
    for (const x of [...live.values()]) x.handle();
  };
}

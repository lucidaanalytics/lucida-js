import { styleTag } from "../csp.js";
import { propOk } from "../targeting.js";
import type { Guide, GuideButton, GuideKind, GuideMedia, GuideStep } from "../types.js";

/** What the renderer reports; the module turns these into $guide_* events. */
export interface GuideHooks {
  shown(): void;
  step(index: number, id: string): void;
  completed(): void;
  dismissed(index: number, id: string): void;
  event(name: string): void;
  /** The step the person moved to (also when a tour waits for another page): persisted so the tour resumes. */
  progress?(stepId: string): void;
}

export interface RenderOpts {
  /** Step index to open at (a resumed tour). */
  start?: number;
  /** Checklist item ids already done. */
  checked?: string[];
  /** Person properties, for step `branch` rules. */
  person?: Record<string, unknown>;
  /** Resource-center modules: the project's guides, and how to open one (closes this panel first). */
  library?: Guide[];
  launch?: (guideId: string) => void;
  /** CSP nonce for the injected `<style>`. */
  nonce?: string;
}

/** What renderGuide returns: the teardown, plus a way to tick a checklist item from outside. */
export type GuideHandle = (() => void) & { markDone(stepId: string): void };

/** The buttons a step shows when it defines none (a click-advance step waits for its target instead of Next). */
export function defaultButtons(kind: GuideKind, last: boolean, first = true, clickAdvance = false): GuideButton[] {
  if (kind === "banner") return [{ label: "Dismiss", action: "dismiss" }];
  const bs: GuideButton[] = first ? [] : [{ label: "Back", action: "back" }];
  if (!clickAdvance) bs.push({ label: last ? "Done" : "Next", action: "next" });
  return [...bs, { label: "Dismiss", action: "dismiss" }];
}

/** The step's target: `selector`, else the first fallback that matches (invalid selectors are skipped). */
export function findTarget(s: GuideStep): Element | null {
  for (const sel of [s.selector, ...(s.fallback_selectors ?? [])]) {
    if (!sel) continue;
    try {
      const e = document.querySelector(sel);
      if (e) return e;
    } catch {
      /* invalid selector: try the next one */
    }
  }
  return null;
}

const CSS =
  ".g{position:fixed;z-index:2147483000;background:#fff;color:#111;border:1px solid #ccc;border-radius:8px;padding:14px;font:14px system-ui;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,.2)}" +
  ".m{top:50%;left:50%;transform:translate(-50%,-50%)}.bn{top:0;left:0;right:0;max-width:none;border-radius:0}.bb{top:auto;bottom:0}.p{right:16px;bottom:16px}" +
  ".o{position:fixed;inset:0;z-index:2146999999;background:rgba(0,0,0,.4)}button{margin:2px;padding:4px 10px;cursor:pointer;background:var(--a,buttonface);color:var(--at,buttontext);border:1px solid #bbb;border-radius:var(--br,4px)}button+button{background:var(--s,buttonface);color:var(--st,buttontext)}h2{margin:0 0 6px;font-size:16px}p{margin:0 0 8px}li{margin:4px 0}" +
  ".so{top:0;bottom:0;right:0;max-width:360px;border-radius:0;overflow:auto;animation:s .2s}.so.sl{right:auto;left:0}@keyframes s{from{transform:translateX(30px);opacity:0}}@media (prefers-reduced-motion:reduce){.so{animation:none}}" +
  ".in{position:static;box-shadow:none;max-width:none;margin:8px 0}img,video,iframe{display:block;width:100%;max-width:100%;border:0;margin:0 0 8px;border-radius:4px}iframe{aspect-ratio:16/9}";
/** Hosts an `embed` media block may frame (mirrors lc-api guides_content::EMBED_HOSTS). */
const EMBED_HOSTS = ["www.youtube-nocookie.com", "www.youtube.com", "player.vimeo.com", "www.loom.com", "fast.wistia.net"];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FOCUSABLE = "button,[href],input,textarea,select,[tabindex]:not([tabindex='-1'])";
const FONT = /^[\w\s,'"-]{1,100}$/;
const SHADOW = { none: "none", sm: "0 1px 4px rgba(0,0,0,.15)", lg: "0 8px 32px rgba(0,0,0,.3)" } as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text; // never innerHTML: guide content is data
  if (cls) e.className = cls;
  return e;
}

/** One media block; anything not https (or an embed of an unknown host) renders nothing. */
export function mediaEl(m: GuideMedia): HTMLElement | null {
  let u: URL;
  try {
    u = new URL(m.url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (m.type === "image") return Object.assign(el("img"), { src: u.href, alt: m.alt ?? "", loading: "lazy" as const });
  if (m.type === "video") return Object.assign(el("video"), { src: u.href, controls: true, preload: "metadata" });
  if (m.type !== "embed" || !EMBED_HOSTS.includes(u.host)) return null;
  const f = Object.assign(el("iframe"), { src: u.href, title: m.alt ?? "Video", allowFullscreen: true, referrerPolicy: "no-referrer" as const });
  f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
  return f;
}

/** Appearance tokens as inline styles on the guide box (values re-checked: colors #hex, radius 0-32). */
function paint(box: HTMLElement, t: NonNullable<Guide["appearance"]>["tokens"]): void {
  const ok = (c: unknown): c is string => typeof c === "string" && HEX.test(c);
  if (ok(t?.background)) box.style.background = t.background;
  if (ok(t?.text)) box.style.color = t.text;
  if (ok(t?.accent)) (box.style.setProperty("--a", t.accent), box.style.setProperty("--at", "#fff"));
  if (typeof t?.radius === "number" && t.radius >= 0 && t.radius <= 32) box.style.borderRadius = `${t.radius}px`;
  if (typeof t?.font === "string" && FONT.test(t.font)) box.style.fontFamily = t.font;
  if (t?.shadow && t.shadow in SHADOW) box.style.boxShadow = SHADOW[t.shadow];
  if (typeof t?.button_radius === "number" && t.button_radius >= 0 && t.button_radius <= 32) box.style.setProperty("--br", `${t.button_radius}px`);
  if (ok(t?.secondary)) box.style.setProperty("--s", t.secondary);
  if (ok(t?.secondary_text)) box.style.setProperty("--st", t.secondary_text);
}

/** Keep Tab inside `box`; Escape calls `esc`. */
function trap(box: HTMLElement, root: ShadowRoot, esc: () => void): void {
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return esc();
    if (e.key !== "Tab") return;
    const f = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!f.length) return;
    const first = f[0]!;
    const last = f[f.length - 1]!;
    const active = root.activeElement;
    if (e.shiftKey && active === first) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && active === last) (e.preventDefault(), first.focus());
  });
}

/** Position `box` next to `target` (fixed coordinates, clamped to the viewport). */
export function place(box: HTMLElement, target: Element, placement = "bottom"): void {
  const r = target.getBoundingClientRect();
  const w = box.offsetWidth || 280;
  const h = box.offsetHeight || 120;
  let left = r.left;
  let top = r.bottom + 8;
  if (placement === "top") top = r.top - h - 8;
  else if (placement === "left") ((left = r.left - w - 8), (top = r.top));
  else if (placement === "right") ((left = r.right + 8), (top = r.top));
  const max = (n: number, lim: number): number => Math.max(8, Math.min(n, lim - 8));
  box.style.left = `${max(left, window.innerWidth - w)}px`;
  box.style.top = `${max(top, window.innerHeight - h)}px`;
}

/**
 * Render a guide in a shadow root. Returns a teardown. Keyboard: Escape dismisses, Tab is trapped in
 * modals; other kinds move focus to their first control. URL buttons open with noopener.
 */
export function renderGuide(g: Guide, hooks: GuideHooks, done: () => void, opts: RenderOpts = {}): GuideHandle {
  const host = document.createElement("div");
  host.setAttribute("data-lc-ignore", "");
  const root = host.attachShadow({ mode: "open" });
  root.append(styleTag(CSS, opts.nonce));
  const prev = document.activeElement as HTMLElement | null;
  let idx = Math.min(Math.max(opts.start ?? 0, 0), g.steps.length - 1);
  let closed = false;
  let overlay: HTMLElement | undefined;
  const visited: number[] = []; // steps behind the current one, for Back
  let unhook = (): void => {}; // the current step's target-click listener / wait timer
  let offOutside = (): void => {};
  const box = el("div", undefined, "g");
  const finish = (): void => {
    if (closed) return;
    closed = true;
    unhook();
    offOutside();
    host.remove();
    prev?.focus?.();
    done();
  };
  const dismiss = (): void => {
    hooks.dismissed(idx, g.steps[idx]?.id ?? "");
    finish();
  };
  const complete = (): void => {
    hooks.completed();
    finish();
  };
  /** Forward-only branching: the button's `goto`, else the first matching `branch` rule, else the next step. */
  const next = (b?: GuideButton): void => {
    const rule = b?.goto ? undefined : g.steps[idx]?.branch?.find((x) => propOk(x, opts.person));
    const goto = b?.goto ?? rule?.goto;
    const to = goto === "end" ? g.steps.length : goto ? g.steps.findIndex((x) => x.id === goto) : -1;
    visited.push(idx);
    idx = to > idx ? to : idx + 1;
    go();
  };
  /** Show step `idx` (or complete past the end); a step on another page leaves, the module resumes the tour there. */
  const go = (): void => {
    const s = g.steps[idx];
    if (!s) return complete();
    hooks.progress?.(s.id);
    if (s.url && !location.href.includes(s.url)) return finish();
    draw();
  };
  const back = (): void => {
    const to = visited.pop();
    if (to === undefined) return;
    idx = to;
    go();
  };
  const act = (b: GuideButton): void => {
    if (b.action === "next" || b.action === "start_tour") next(b);
    else if (b.action === "back") back();
    else if (b.action === "dismiss") dismiss();
    else if (b.action === "link" && b.url && /^https?:\/\//i.test(b.url)) {
      window.open(b.url, "_blank", "noopener,noreferrer");
    } else if (b.action === "event" && b.event) hooks.event(b.event);
  };
  const buttons = (s: GuideStep, last: boolean): HTMLElement => {
    const row = el("div");
    const bs = s.buttons?.length ? s.buttons : defaultButtons(g.kind, last, visited.length === 0, s.advance === "click");
    for (const b of bs) {
      const x = el("button", b.label);
      x.type = "button";
      x.onclick = () => act(b);
      row.append(x);
    }
    return row;
  };
  const body = (s: GuideStep): HTMLElement[] => [
    ...(s.title ? [el("h2", s.title)] : []),
    ...(s.body ? [el("p", s.body)] : []),
    ...(s.media ?? []).flatMap((m) => mediaEl(m) ?? []),
  ];
  const ticked = new Set<string>(opts.checked); // checklist: items done
  const items = new Map<string, HTMLButtonElement>();
  /** Mark a checklist item done (a click or its `complete_on` event); `report` emits the step event and may finish the list. */
  function tick(i: number, s: GuideStep, report: boolean): void {
    const cb = items.get(s.id);
    if (cb && !cb.hasAttribute("data-done")) {
      cb.setAttribute("data-done", "");
      cb.setAttribute("aria-pressed", "true");
      cb.textContent = `✓ ${s.title ?? s.id}`;
    }
    if (!report || (ticked.has(s.id) && cb?.hasAttribute("data-reported"))) return;
    cb?.setAttribute("data-reported", "");
    ticked.add(s.id);
    hooks.step(i, s.id);
    if (ticked.size >= g.steps.length) complete();
  }
  const listPanel = (): void => {
    const list = el("ul");
    for (const [i, s] of g.steps.entries()) {
      const li = el("li");
      const cb = el("button", `${s.title ?? s.id}`);
      cb.type = "button";
      cb.setAttribute("aria-pressed", "false");
      items.set(s.id, cb);
      if (ticked.has(s.id)) (tick(i, s, false), cb.setAttribute("data-reported", ""));
      cb.onclick = () => {
        if (g.kind === "checklist") tick(i, s, true);
        else if (g.kind === "resource_center") {
          hooks.step(i, s.id);
          const b = s.buttons?.find((x) => x.action === "link");
          if (b) act(b);
        }
      };
      if (s.module) {
        // lazy: module renderers are a separate chunk, fetched only for a resource center that uses them
        const ctx = { library: opts.library ?? [], launch: (id: string) => (finish(), opts.launch?.(id)), opened: () => hooks.step(i, s.id) };
        void import("./modules.js").then((m) => li.append(m.renderModule(s, ctx)));
        list.append(li);
        continue;
      }
      li.append(cb);
      if (s.body) li.append(el("p", s.body));
      list.append(li);
    }
    box.append(el("h2", g.name), list);
    const x = el("button", g.kind === "resource_center" ? "Close" : "Dismiss");
    x.type = "button";
    x.onclick = dismiss;
    box.append(x);
  };
  function draw(): void {
    unhook();
    box.replaceChildren();
    box.style.visibility = "";
    const s = g.steps[idx];
    if (!s) return;
    if (g.kind === "checklist" || g.kind === "resource_center") listPanel();
    else {
      box.append(...body(s), buttons(s, idx === g.steps.length - 1));
      hooks.step(idx, s.id);
    }
    box.setAttribute("role", g.kind === "banner" || g.kind === "inline" ? "region" : "dialog");
    box.setAttribute("aria-label", s?.title ?? g.name);
    const cls: Partial<Record<GuideKind, string>> = { modal: "m", banner: `bn${s.placement === "bottom" ? " bb" : ""}`, slideout: `so${g.appearance?.side === "left" ? " sl" : ""}`, inline: "in" };
    box.className = `g ${cls[g.kind] ?? "p"}`;
    paint(box, g.appearance?.tokens);
    if (g.kind === "modal") box.setAttribute("aria-modal", "true");
    const anchored = (g.kind === "tooltip" || g.kind === "tour") && !!(s.selector || s.fallback_selectors?.length);
    const attach = (a: Element): void => {
      box.style.visibility = "";
      box.classList.remove("p");
      place(box, a, s.placement);
      if (s.advance !== "click") return;
      const onClick = (): void => next();
      a.addEventListener("click", onClick, { once: true });
      unhook = () => a.removeEventListener("click", onClick);
    };
    const anchor = anchored ? findTarget(s) : null;
    if (anchor) attach(anchor);
    else if (anchored) {
      // the target may render later (SPA): hide the step and look again until the wait runs out, then show it unanchored
      box.style.visibility = "hidden";
      const until = Date.now() + Math.min(Math.max(s.wait_ms ?? 3000, 0), 15_000);
      const t = setInterval(() => {
        const a = findTarget(s);
        if (a) (clearInterval(t), attach(a));
        else if (Date.now() >= until) (clearInterval(t), (box.style.visibility = ""));
      }, 150);
      unhook = () => clearInterval(t);
    }
    if (g.kind !== "inline") box.querySelector<HTMLElement>("button")?.focus(); // inline content never steals focus
  }
  trap(box, root, dismiss);
  const modal = g.kind === "modal";
  const outside = g.appearance?.dismiss_on_outside_click ?? modal;
  if (g.appearance?.overlay ?? modal) {
    overlay = el("div", undefined, "o");
    if (outside) overlay.onclick = dismiss;
    root.append(overlay);
  } else if (outside && g.kind !== "inline") {
    const away = (e: MouseEvent): void => {
      if (!e.composedPath().includes(host)) dismiss();
    };
    // next tick: the click that launched the guide must not close it
    const t = setTimeout(() => document.addEventListener("click", away, true));
    offOutside = () => (clearTimeout(t), document.removeEventListener("click", away, true));
  }
  root.append(box);
  const slot = g.kind === "inline" && g.steps[0]?.selector ? document.querySelector(g.steps[0].selector) : null;
  if (slot) slot.after(host); // inline: part of the page flow, right after its element
  else document.body.append(host);
  hooks.shown();
  draw();
  return Object.assign(finish, {
    markDone(stepId: string): void {
      const i = g.steps.findIndex((x) => x.id === stepId);
      if (g.kind === "checklist" && i >= 0 && !closed) tick(i, g.steps[i]!, true);
    },
  });
}

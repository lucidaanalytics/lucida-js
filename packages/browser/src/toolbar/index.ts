import { cssSelector } from "../autocapture/click.js";
import type { Host, Module } from "../types.js";
import { actionsPanel, stepFromElement } from "./actions-ui.js";
import { EDIT_PARAM, TOOLBAR_PARAM, exchangeToken, toolbarApi } from "./api.js";
import type { ToolbarSession } from "./api.js";
import { eventDebugger } from "./debugger.js";
import { btn, el } from "./dom.js";
import { createEditor } from "./editor.js";
import { flagsPanel } from "./flags-ui.js";
import { STABLE_ATTRS } from "./guide-draft.js";
import { heatPanel } from "./heat.js";

export * from "./api.js";

const SESSION_KEY = "lc_toolbar_session";
const EDIT_KEY = "lc_toolbar_edit";
const CHECK_KEY = "lc_toolbar_check";
// duplicated from guide-check.ts so the check code stays in its lazy chunk
const CHECK_PARAM = "__lc_check";

function loadSession(): ToolbarSession | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as ToolbarSession | null;
    return s && (!s.expires_at || Date.parse(s.expires_at) > Date.now()) ? s : null;
  } catch {
    return null;
  }
}

/**
 * Remove the one-time token (and the editor target) from the address bar so it is not shared or logged. The token
 * may sit in the query or, for frameworks that rewrite the query on boot, in the hash (`#__lc_toolbar=...`).
 */
function stripToken(): string | null {
  const u = new URL(location.href);
  const hash = new URLSearchParams(u.hash.slice(1));
  const t = u.searchParams.get(TOOLBAR_PARAM) ?? hash.get(TOOLBAR_PARAM);
  const edit = u.searchParams.get(EDIT_PARAM) ?? hash.get(EDIT_PARAM);
  const check = u.searchParams.get(CHECK_PARAM) ?? hash.get(CHECK_PARAM);
  if (edit) sessionStorage.setItem(EDIT_KEY, edit); // this tab keeps editing that experiment across pages
  if (check) sessionStorage.setItem(CHECK_KEY, check); // run once, after the session is authorized
  if (t || edit || check) {
    u.searchParams.delete(TOOLBAR_PARAM);
    u.searchParams.delete(EDIT_PARAM);
    u.searchParams.delete(CHECK_PARAM);
    if (hash.has(TOOLBAR_PARAM) || hash.has(EDIT_PARAM) || hash.has(CHECK_PARAM)) {
      hash.delete(TOOLBAR_PARAM);
      hash.delete(EDIT_PARAM);
      hash.delete(CHECK_PARAM);
      u.hash = hash.toString();
    }
    history.replaceState(history.state, "", u.toString());
  }
  return t;
}

/**
 * Toolbar (lazy, authorized). Activates only with `?__lc_toolbar=<token>` (or `#__lc_toolbar=`, or
 * `client.loadToolbar(token)`, or a live session from this tab): exchanges the token at POST /v1/toolbar/exchange
 * (on `uiHost` when set), then offers element inspect -> multi-element actions and the existing-actions overlay, a
 * heatmap layer (click/rage/dead/move/scroll with numbered element boxes), local flag overrides, an event debugger,
 * the guide builder and, with `&__lc_edit=<experiment id>`, the experiment visual editor. The UI lives in a shadow
 * root marked data-lc-ignore so SDK capture never sees it. View-only sessions (toolbar `read`) get overlays only.
 */
export const toolbar: Module = (host: Host) => {
  const token = stripToken();
  let cleanup: (() => void) | undefined;
  const start = async (t: string | null): Promise<boolean> => {
    let session = loadSession();
    if (t) {
      session = await exchangeToken(host, t);
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
    if (!session) return false;
    cleanup?.();
    cleanup = mount(host, session);
    return true;
  };
  host.toolbar = { load: (t) => start(t) };
  if (token || loadSession()) void start(token);
  return () => cleanup?.();
};

function mount(host: Host, session: ToolbarSession): () => void {
  const api = toolbarApi(host, session);
  const can = (s: string) => (session.permissions ?? []).includes(s);
  const attrs = host.config.toolbar?.dataAttributes ?? STABLE_ATTRS;
  const root = document.createElement("div");
  root.setAttribute("data-lc-ignore", "");
  root.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647";
  const sh = root.attachShadow({ mode: "open" });
  const panel = el("div", undefined, "background:#111;color:#eee;padding:8px;border-radius:8px;font:12px system-ui;max-width:340px;max-height:70vh;overflow:auto");
  sh.append(panel);
  const out = el("div", undefined, "white-space:pre-wrap");
  const note = (t: string): void => void (out.textContent = t);

  let picked: Element | undefined;
  let inspecting = false;
  let builder: HTMLElement | undefined;
  let expEditor: HTMLElement | undefined;
  const hl = el("div", undefined, "position:fixed;pointer-events:none;border:2px solid #4af;z-index:2147483646;display:none");
  hl.setAttribute("data-lc-ignore", "");
  const move = (e: MouseEvent): void => {
    const t = e.target;
    if (!inspecting || !(t instanceof Element) || t === root) return;
    const r = t.getBoundingClientRect();
    Object.assign(hl.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  const pick = (e: MouseEvent): void => {
    if (!inspecting || !(e.target instanceof Element) || e.target === root) return;
    e.preventDefault();
    e.stopPropagation();
    picked = e.target;
    inspecting = false;
    hl.style.display = "none";
    note(`Selected ${cssSelector(picked)}`);
  };
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", pick, true);
  document.body.append(hl);

  const teardowns: Array<() => void> = [];
  /** A collapsible section: the panel is built on first open. */
  const section = (label: string, build: () => { node: HTMLElement; teardown: () => void }): HTMLElement => {
    const wrap = el("div");
    let built: HTMLElement | undefined;
    const toggle = btn(label, () => {
      if (!built) {
        const p = build();
        built = p.node;
        teardowns.push(p.teardown);
        wrap.append(built);
      } else built.hidden = !built.hidden;
      toggle.setAttribute("aria-expanded", String(!built.hidden));
    });
    toggle.setAttribute("aria-expanded", "false");
    wrap.prepend(toggle);
    return wrap;
  };

  const actions = can("actions:write") ? actionsPanel({ api, attrs, picked: () => picked, note }) : undefined;
  if (actions) {
    actions.node.hidden = true;
    teardowns.push(actions.teardown);
  }
  const actionsToggle = actions
    ? btn("Actions", () => {
        actions.node.hidden = !actions.node.hidden;
        actionsToggle?.setAttribute("aria-expanded", String(!actions.node.hidden));
      })
    : undefined;

  const editor = createEditor();
  const needPick = (f: (el: Element) => void) => (): void => (picked ? f(picked) : note("Inspect an element first"));
  const showChanges = (): void => note(JSON.stringify(editor.toPayload(), null, 1));
  const edit = (label: string, ask: string, f: (el: Element, v: string) => void): HTMLButtonElement =>
    btn(label, needPick((el) => {
      const v = window.prompt(ask);
      if (v !== null) (f(el, v), showChanges());
    }));
  const internalLabel = (): string => (host.client.isInternal ? "Count my traffic" : "Exclude my traffic ($internal)");
  const internalBtn: HTMLButtonElement = btn(internalLabel(), () => {
    host.client.optOutInternal(!host.client.isInternal);
    internalBtn.textContent = internalLabel();
  });

  const editBtn = btn("Experiment editor", async () => {
    if (expEditor) return void (expEditor.remove(), (expEditor = undefined));
    const id = sessionStorage.getItem(EDIT_KEY) ?? window.prompt("Experiment id");
    if (!id) return;
    sessionStorage.setItem(EDIT_KEY, id);
    const { experimentEditor } = await import("./experiment-editor.js"); // lazy: only loaded when the editor is opened
    expEditor = await experimentEditor({ api, scopes: session.permissions, experimentId: id, picked: () => picked, note });
    panel.prepend(expEditor);
  });

  panel.append(
    el("b", `Lucida toolbar${session.user?.email ? ` - ${session.user.email}` : ""}${can("actions:write") ? "" : " (view only)"}`),
    el("br"),
    internalBtn,
    btn("Inspect element", () => ((inspecting = true), note("Click an element"))),
    ...(actionsToggle && actions ? [actionsToggle, actions.node] : []),
    section("Heatmap", () =>
      heatPanel({
        api,
        note,
        onPick: (e) => {
          picked = e;
          if (!actions) return note("Creating actions needs toolbar write access");
          actions.addStep(stepFromElement(e, attrs));
          actions.node.hidden = false;
          note(`Added ${cssSelector(e)} to the action`);
        },
      }),
    ),
    section("Feature flags", () => flagsPanel(host, api)),
    section("Event debugger", () => eventDebugger(host)),
    // the guide builder and experiment editor explain a missing scope themselves
    btn("Guide builder", async () => {
      if (builder) return void (builder.remove(), (builder = undefined));
      const { guideBuilder } = await import("./guide-ui.js"); // lazy: only loaded when the builder is opened
      builder = guideBuilder({ api, scopes: session.permissions, picked: () => picked, note });
      panel.append(builder);
    }),
    editBtn,
    el("hr"),
    el("b", "Visual editor"),
    el("br"),
    edit("Text", "New text", (el, v) => editor.text(el, v)),
    edit("Style", "CSS as property:value", (el, v) => {
      const [p, ...r] = v.split(":");
      if (p && r.length) editor.style(el, p.trim(), r.join(":").trim());
    }),
    edit("Attribute", "name=value (empty value removes)", (el, v) => {
      const [n, ...r] = v.split("=");
      if (n) editor.attr(el, n.trim(), r.length && r.join("=") !== "" ? r.join("=") : null);
    }),
    btn("Hide", needPick((el) => (editor.hide(el), showChanges()))),
    btn("Move up", needPick((el) => (editor.move(el, -1), showChanges()))),
    btn("Move down", needPick((el) => (editor.move(el, 1), showChanges()))),
    btn("Show changes JSON", showChanges),
    out,
  );
  document.body.append(root);
  if (sessionStorage.getItem(EDIT_KEY)) editBtn.click(); // opened from the app: start in the editor
  const check = sessionStorage.getItem(CHECK_KEY);
  if (check) {
    sessionStorage.removeItem(CHECK_KEY);
    void import("./guide-check.js").then(({ parseCheck, runCheck }) => {
      const req = parseCheck(check);
      if (req) void runCheck(req, note);
      else note("The guide check request is malformed");
    });
  }
  return () => {
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", pick, true);
    for (const t of teardowns) t();
    root.remove();
    hl.remove();
  };
}

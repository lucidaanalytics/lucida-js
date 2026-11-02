import { cssSelector } from "../autocapture/click.js";
import { applyChanges, CHANGES_KEY, removeInserted } from "../experiments/changes.js";
import type { ApplyOptions, Change, InsertPosition } from "../experiments/changes.js";

type Body = Change extends infer C ? (C extends unknown ? Omit<C, "selector" | "url"> : never) : never;

/** What an element looked like before the editor first touched it (to revert the preview). */
interface Original {
  attrs: [string, string][];
  kids: Node[];
  parent: Node | null;
  next: Node | null;
}

const MAX_HISTORY = 100;

/**
 * Visual editor recorder (LC-EXT-16, 37; P-H5): every edit is applied live for preview and recorded as a
 * change against the element's selector. A later edit of the same thing replaces the earlier one.
 * `initial` is the variant's saved list; `pageOnly()` true scopes new changes to this page path
 * (multipage tests). `toPayload()` is the JSON stored on the experiment variant (or flag) payload.
 * Undo / redo restore the touched elements to their original state, drop inserted HTML and page CSS,
 * then re-apply the current list, so the preview always shows exactly the recorded set. Custom JS is
 * recorded but never run in the editor (it runs on the site once approved).
 */
export function createEditor(initial: Change[] = [], pageOnly: () => boolean = () => false, opts: ApplyOptions = {}) {
  let changes: Change[] = [...initial];
  const undoStack: Change[][] = [];
  const redoStack: Change[][] = [];
  const originals = new Map<Element, Original>();
  const subs = new Set<() => void>();
  const key = (c: Change): string => `${c.url ?? ""}|${c.selector ?? ""}|${c.type}|${c.type === "attr" ? c.name : ""}`;

  const remember = (selector: string | undefined): void => {
    if (!selector) return;
    let els: Element[] = [];
    try {
      els = [...document.querySelectorAll(selector)];
    } catch {
      return;
    }
    for (const el of els) {
      if (originals.has(el)) continue;
      originals.set(el, {
        attrs: [...el.attributes].map((a) => [a.name, a.value]),
        kids: [...el.childNodes].map((n) => n.cloneNode(true)),
        parent: el.parentNode,
        next: el.nextSibling,
      });
    }
  };
  /** Revert every touched element, then show `changes` again. */
  const repaint = (): void => {
    removeInserted();
    for (const [el, o] of originals) {
      for (const a of [...el.attributes]) el.removeAttribute(a.name);
      for (const [n, v] of o.attrs) el.setAttribute(n, v);
      el.replaceChildren(...o.kids.map((n) => n.cloneNode(true)));
      if (o.parent && (o.next === null || o.next.parentNode === o.parent)) o.parent.insertBefore(el, o.next);
    }
    applyChanges(changes, document, { ...opts, allowJs: false });
    for (const s of subs) s();
  };
  const commit = (next: Change[]): void => {
    undoStack.push(changes);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    changes = next;
  };
  const record = (selector: string | undefined, body: Body): void => {
    remember(selector);
    const c = { ...body, ...(selector ? { selector } : {}), ...(pageOnly() ? { url: location.pathname } : {}) } as Change;
    const next = changes.filter((x) => key(x) !== key(c));
    next.push(c);
    commit(next);
    applyChanges([c], document, { ...opts, allowJs: false });
    for (const s of subs) s();
  };
  const siblingIndex = (el: Element): number => (el.parentElement ? [...el.parentElement.children].indexOf(el) : 0);
  for (const c of initial) remember(c.selector);
  return {
    changes: (): readonly Change[] => changes,
    text: (el: Element, value: string): void => record(cssSelector(el), { type: "text", value }),
    attr: (el: Element, name: string, value: string | null): void => record(cssSelector(el), { type: "attr", name, value }),
    style: (el: Element, prop: string, value: string): void => {
      const selector = cssSelector(el);
      const prev = changes.find((c) => c.selector === selector && c.type === "style");
      record(selector, { type: "style", styles: { ...(prev?.type === "style" ? prev.styles : {}), [prop]: value } });
    },
    hide: (el: Element): void => record(cssSelector(el), { type: "hide" }),
    /** Move one position earlier (-1) or later (+1) among siblings. */
    move: (el: Element, delta: -1 | 1): void => {
      const to = Math.max(0, Math.min(siblingIndex(el) + delta, (el.parentElement?.children.length ?? 1) - 1));
      record(cssSelector(el), { type: "reorder", index: to });
    },
    /** Insert HTML (sanitized when applied) before / after / inside the element. */
    insert: (el: Element, position: InsertPosition, html: string): void => {
      // Several inserts at one element are distinct changes: the key would otherwise merge them.
      remember(cssSelector(el));
      const c = { type: "insert", position, html, selector: cssSelector(el), ...(pageOnly() ? { url: location.pathname } : {}) } as Change;
      commit([...changes, c]);
      applyChanges([c], document, opts);
      for (const s of subs) s();
    },
    image: (el: Element, src: string, alt?: string): void =>
      record(cssSelector(el), { type: "image", src, ...(alt !== undefined ? { alt } : {}) }),
    /** Page CSS for this variant (one per variant: a new one replaces it). */
    css: (css: string): void => record(undefined, { type: "css", css }),
    /** Page JS for this variant; it needs approval and the site's opt-in before it runs. */
    js: (js: string): void => record(undefined, { type: "js", js }),
    canUndo: (): boolean => undoStack.length > 0,
    canRedo: (): boolean => redoStack.length > 0,
    undo: (): void => {
      const prev = undoStack.pop();
      if (!prev) return;
      redoStack.push(changes);
      changes = prev;
      repaint();
    },
    redo: (): void => {
      const next = redoStack.pop();
      if (!next) return;
      undoStack.push(changes);
      changes = next;
      repaint();
    },
    /** Drop change `i` from the list and the preview. */
    remove: (i: number): void => {
      if (i < 0 || i >= changes.length) return;
      commit(changes.filter((_, j) => j !== i));
      repaint();
    },
    /** Called after every edit, undo and redo (the panel redraws its list). */
    onChange: (cb: () => void): (() => void) => (subs.add(cb), () => void subs.delete(cb)),
    toPayload: (): { [CHANGES_KEY]: Change[] } => ({ [CHANGES_KEY]: [...changes] }),
  };
}

export type Editor = ReturnType<typeof createEditor>;

/** Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z (or Ctrl+Y) redoes; typing in a field keeps the browser's own undo. */
export function bindUndoKeys(ed: () => Pick<Editor, "undo" | "redo">, target: Document = document): () => void {
  const on = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) ed().undo();
    else if ((k === "z" && e.shiftKey) || k === "y") ed().redo();
    else return;
    e.preventDefault();
  };
  target.addEventListener("keydown", on);
  return () => target.removeEventListener("keydown", on);
}

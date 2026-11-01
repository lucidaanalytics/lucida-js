import { cssSelector } from "../autocapture/click.js";
import { applyChanges, CHANGES_KEY } from "../experiments/changes.js";
import type { Change } from "../experiments/changes.js";

type Body = Change extends infer C ? (C extends unknown ? Omit<C, "selector" | "url"> : never) : never;

/**
 * Visual editor recorder (LC-EXT-16, 37): every edit is applied live for preview and recorded as a
 * change against the element's selector. A later edit of the same thing replaces the earlier one.
 * `initial` is the variant's saved list; `pageOnly()` true scopes new changes to this page path
 * (multipage tests). `toPayload()` is the JSON stored on the experiment variant (or flag) payload.
 */
export function createEditor(initial: Change[] = [], pageOnly: () => boolean = () => false) {
  const changes: Change[] = [...initial];
  const key = (c: Change): string => `${c.url ?? ""}|${c.selector}|${c.type}|${c.type === "attr" ? c.name : ""}`;
  const record = (selector: string, body: Body): void => {
    const c = { ...body, selector, ...(pageOnly() ? { url: location.pathname } : {}) } as Change;
    const i = changes.findIndex((x) => key(x) === key(c));
    if (i >= 0) changes.splice(i, 1);
    changes.push(c);
    applyChanges([c]);
  };
  const siblingIndex = (el: Element): number => (el.parentElement ? [...el.parentElement.children].indexOf(el) : 0);
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
    undoLast: (): void => void changes.pop(), // preview is not reverted; reload the page to see the remaining set
    /** Drop change `i` from the list (the page keeps it until reload). */
    remove: (i: number): void => void changes.splice(i, 1),
    toPayload: (): { [CHANGES_KEY]: Change[] } => ({ [CHANGES_KEY]: [...changes] }),
  };
}

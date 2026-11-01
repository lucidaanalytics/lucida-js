import type { Guide } from "../types.js";
import { renderGuide } from "./render.js";

/**
 * Changelog widget: announcements are the project's banner guides (the model has no separate
 * announcement kind). Shown as a resource-center panel, one entry per banner (first step's
 * title/body). Returns the teardown, or undefined when there is nothing to list.
 */
export function showChangelog(list: Guide[], shown: () => void, done: () => void, nonce?: string): (() => void) | undefined {
  const entries = list.filter((g) => g.kind === "banner" && g.steps[0]);
  if (!entries.length) return undefined;
  const panel: Guide = {
    id: "changelog",
    name: "What's new",
    kind: "resource_center",
    steps: entries.map((g) => ({ id: g.id, title: g.steps[0]!.title ?? g.name, ...(g.steps[0]!.body ? { body: g.steps[0]!.body } : {}) })),
    conditions: {},
  };
  const noop = (): void => {};
  return renderGuide(panel, { shown, step: noop, completed: noop, dismissed: noop, event: noop }, done, nonce ? { nonce } : {});
}

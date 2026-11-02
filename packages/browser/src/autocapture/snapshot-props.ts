import type { Props } from "@lucida-analytics/sdk-core";
import { policyMatches } from "../replay/index.js";
import type { Host } from "../types.js";

/**
 * No-code snapshot properties (P-M15): remote rules (`snapshot_properties` in GET /v1/config, set in the
 * web app or with the toolbar picker) copy the visible text or one attribute of a matching element onto
 * `$autocapture` clicks and/or `$pageview`s. Form controls, editable and masked elements are never read,
 * nor `value`/event-handler attributes; card-like digit runs are dropped.
 */
export interface SnapshotRule {
  name: string;
  selector: string;
  source: "text" | "attribute";
  attribute?: string;
  events: Array<"click" | "pageview">;
  /** `target`: the closest match around the clicked element (click rules only). Default `page`: first match in the document. */
  scope?: "page" | "target";
  /** URL pattern (substring, `*` wildcard, `re:` regex). */
  url?: string;
}

const MAX = 255;
const FORM = new Set(["input", "textarea", "select", "option"]);
const NEVER = "[data-lc-mask],.lc-mask,[data-lc-no-capture],.lc-no-capture,[data-lc-block]";
const DENIED_ATTRS = new Set(["value", "password", "autocomplete"]);
const SENSITIVE = /(?:\d[ -]?){9,}/;
const byHost = new WeakMap<Host, SnapshotRule[]>();

/** Well-formed rules only (remote config is untrusted input). */
export function snapshotRules(v: unknown): SnapshotRule[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is SnapshotRule => {
    if (!r || typeof r !== "object") return false;
    const x = r as Partial<SnapshotRule>;
    return (
      typeof x.name === "string" &&
      x.name !== "" &&
      !x.name.startsWith("$") &&
      typeof x.selector === "string" &&
      (x.source === "text" || (x.source === "attribute" && typeof x.attribute === "string")) &&
      Array.isArray(x.events)
    );
  });
}

function readable(el: Element | null): el is Element {
  if (!el) return false;
  if (FORM.has(el.tagName.toLowerCase()) || (el as HTMLElement).isContentEditable) return false;
  try {
    return !el.closest(NEVER);
  } catch {
    return false;
  }
}

function valueOf(rule: SnapshotRule, el: Element): string | undefined {
  if (rule.source === "attribute") {
    const a = (rule.attribute ?? "").toLowerCase();
    if (!a || DENIED_ATTRS.has(a) || a.startsWith("on")) return undefined;
    const v = el.getAttribute(a);
    return v === null ? undefined : v.slice(0, MAX);
  }
  const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!t || SENSITIVE.test(t)) return undefined;
  return t.slice(0, MAX);
}

/** Property values of the rules for `event` on this page (`target`: the clicked element). */
export function readSnapshot(rules: SnapshotRule[], event: "click" | "pageview", target?: Element, url: string = location.href): Props {
  const out: Props = {};
  for (const r of rules) {
    if (!r.events.includes(event) || (r.url && !policyMatches([r.url], url))) continue;
    let el: Element | null = null;
    try {
      el = r.scope === "target" ? (event === "click" && target ? target.closest(r.selector) : null) : document.querySelector(r.selector);
    } catch {
      continue; // a selector the browser rejects reads nothing
    }
    if (!readable(el)) continue;
    const v = valueOf(r, el);
    if (v !== undefined) out[r.name] = v;
  }
  return out;
}

/** Loads the rules from remote config and adds them to clicks; pageviews read them through pageviewSnapshot(). */
export function startSnapshots(host: Host): () => void {
  let on = true;
  void host.loadConfig().then((cfg) => {
    if (on) byHost.set(host, snapshotRules(cfg?.snapshot_properties));
  });
  host.clickExtras.push((_ev, el) => (on ? readSnapshot(byHost.get(host) ?? [], "click", el) : {}));
  return () => {
    on = false;
    byHost.delete(host);
  };
}

export function pageviewSnapshot(host: Host): Props {
  const rules = byHost.get(host);
  return rules?.length ? readSnapshot(rules, "pageview") : {};
}

/** True when pageview rules exist: SPA route pageviews then wait one task so the new route can render. */
export function hasPageviewRules(host: Host): boolean {
  return !!byHost.get(host)?.some((r) => r.events.includes("pageview"));
}

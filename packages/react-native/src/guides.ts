import type { Core, Props } from "@lucida-analytics/sdk-core";

const KINDS = ["modal", "banner", "announcement", "slideout", "tour", "carousel", "tooltip", "hotspot"];
/** Kinds whose steps may point at a view (`<GuideAnchor testID>`). */
const ANCHORABLE = ["tooltip", "hotspot", "tour"];
/** Targeting keys this engine honours; a guide using any other (non-empty) key is skipped, never shown to the wrong people. */
const HANDLED = ["url", "url_match", "flag_key", "sample_pct", "devices", "seen_guides", "not_seen_guides", "delay_seconds", "goal", "exclude_url_patterns"];
const SEEN_KEY = "lc_guide_seen";

export interface GuideButton {
  label: string;
  /** next | back | dismiss | link | event (start_tour behaves like next on mobile). */
  action: string;
  url?: string;
  event?: string;
}

export interface GuideStep {
  id: string;
  title?: string | null;
  body?: string | null;
  buttons?: GuideButton[] | null;
  /** Anchor view: the `testID` of a `<GuideAnchor>` (tooltip, hotspot and tour steps; web selectors are ignored). */
  native_id?: string | null;
  placement?: string | null;
  /** How long to wait for the anchor (ms, default 3000, max 15000) before showing the step unanchored. */
  wait_ms?: number | null;
}

/** Where an anchored step points. `hotspot`: a pulsing dot on the view opens the step. */
export interface GuideAnchorSpec {
  nativeId: string;
  placement?: string;
  waitMs: number;
  hotspot: boolean;
}

/** A guide as `GET /v1/guides` serves it. */
export interface MobileGuide {
  id: string;
  name: string;
  kind: string;
  steps: GuideStep[];
  conditions: Record<string, unknown>;
  /** A draft served to a QA user: no targeting, shown once per launch, no events. */
  preview?: boolean;
  /** Resolved appearance (the gateway merges the project theme in): tokens, dark.tokens, theme_mode, font_family. */
  appearance?: Record<string, unknown> | null;
  /** A workflow queued this guide for this person (gateway): it goes first and skips sampling. */
  queued?: boolean;
}

/** What `<LucidaGuides />` draws. */
export interface GuideView {
  guide: MobileGuide;
  step: number;
  buttons: GuideButton[];
  /** Set when this step points at a view. */
  anchor?: GuideAnchorSpec;
}

export interface GuidesService {
  /** Fetches the live guides (needs analytics consent), then re-evaluates the current screen. */
  reload(): Promise<void>;
  /** The app moved to `name`: show the first eligible guide if none is on screen. */
  show(name: string): void;
  current(): GuideView | null;
  subscribe(cb: (v: GuideView | null) => void): () => void;
  /** The tapped button, or null when the person closed the step (a dismissal). */
  act(button: GuideButton | null): void;
  /** How https links open (the view wires Linking.openURL). */
  setOpener(fn: (url: string) => void): void;
  /** The view could not find the current step's anchor in time (emits `$guide_target_missing`; it then shows unanchored). */
  targetMissing(): void;
}

export interface GuidesDeps {
  core: Core;
  fetch: typeof fetch;
  apiHost: string;
  apiKey: string;
  flag(key: string): boolean;
  random?: () => number;
}

export function matches(screen: string, pattern: string, how: string): boolean {
  if (how === "exact") return screen === pattern;
  if (how === "regex") {
    try {
      return new RegExp(pattern).test(screen);
    } catch {
      return false;
    }
  }
  return screen.includes(pattern);
}

export function guideButtons(g: MobileGuide, i: number): GuideButton[] {
  const b = g.steps[i]?.buttons;
  if (b && b.length) return b;
  if (g.kind === "banner" || g.kind === "announcement") return [{ label: "Dismiss", action: "dismiss" }];
  if (g.kind === "carousel") {
    const last = i === g.steps.length - 1;
    return [...(i > 0 ? [{ label: "Back", action: "back" }] : []), { label: last ? "Done" : "Next", action: "next" }, { label: "Dismiss", action: "dismiss" }];
  }
  return [{ label: i === g.steps.length - 1 ? "Done" : "Next", action: "next" }, { label: "Dismiss", action: "dismiss" }];
}

/** Project-wide exclusions matched against the screen name: `*` globs, the same patterns the web matches against URLs. */
export function screenExcluded(screen: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => !!p && new RegExp("^" + p.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(screen));
}

/** The anchor of step `i`, when its guide kind anchors and the step names a view. */
export function guideAnchor(g: MobileGuide, i: number): GuideAnchorSpec | undefined {
  const s = g.steps[i];
  const id = s?.native_id;
  if (!s || !id || !ANCHORABLE.includes(g.kind)) return undefined;
  const wait = Math.min(Math.max(s.wait_ms ?? 3000, 0), 15_000);
  return { nativeId: id, ...(s.placement ? { placement: s.placement } : {}), waitMs: wait, hotspot: g.kind === "hotspot" };
}

// null, "" and [] are the editor's "not set"
const unset = (v: unknown): boolean => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function createGuides(d: GuidesDeps): GuidesService {
  const { core } = d;
  const random = d.random ?? Math.random;
  let guides: MobileGuide[] = [];
  let seen = new Set<string>();
  try {
    seen = new Set(strs(JSON.parse(core.storage.get(SEEN_KEY) ?? "[]")));
  } catch {
    /* corrupt: start empty */
  }
  const previewed = new Set<string>();
  const subs = new Set<(v: GuideView | null) => void>();
  let view: GuideView | null = null;
  let screen: string | undefined;
  let open: (url: string) => void = () => undefined;

  const set = (v: GuideView | null): void => {
    view = v;
    for (const s of subs) s(v);
  };
  const props = (g: MobileGuide, extra: Props = {}): Props => ({ ...extra, $guide_id: g.id, $guide_kind: g.kind });

  const eligible = (g: MobileGuide, name: string): boolean => {
    if (!KINDS.includes(g.kind) || !g.steps?.length) return false;
    // tooltip / hotspot exist only next to a view
    if ((g.kind === "tooltip" || g.kind === "hotspot") && !g.steps[0]?.native_id) return false;
    if (g.preview) return !previewed.has(g.id);
    const c = g.conditions ?? {};
    if (seen.has(g.id) || !Object.keys(c).every((k) => unset(c[k]) || HANDLED.includes(k))) return false;
    const url = c["url"];
    if (typeof url === "string" && url && !matches(name, url, typeof c["url_match"] === "string" ? c["url_match"] : "contains")) return false;
    const f = c["flag_key"];
    if (typeof f === "string" && f && !d.flag(f)) return false;
    if (screenExcluded(name, strs(c["exclude_url_patterns"]))) return false;
    const pct = c["sample_pct"];
    if (!g.queued && typeof pct === "number" && random() * 100 >= pct) return false;
    if (!unset(c["devices"]) && !strs(c["devices"]).some((x) => x === "mobile" || x === "tablet")) return false;
    if (!unset(c["seen_guides"]) && !strs(c["seen_guides"]).every((x) => seen.has(x))) return false;
    if (!unset(c["not_seen_guides"]) && strs(c["not_seen_guides"]).some((x) => seen.has(x))) return false;
    return true;
  };

  const markSeen = (id: string): void => {
    seen.add(id);
    core.storage.set(SEEN_KEY, JSON.stringify([...seen].sort()));
  };

  const present = (g: MobileGuide, i: number): void => {
    const anchor = guideAnchor(g, i);
    set({ guide: g, step: i, buttons: guideButtons(g, i), ...(anchor ? { anchor } : {}) });
  };

  const finish = (): void => {
    set(null);
    if (screen !== undefined) svc.show(screen); // the next eligible guide, if any
  };

  const svc: GuidesService = {
    async reload() {
      if (!core.hasConsent("analytics")) return;
      try {
        const q = new URLSearchParams({ api_key: d.apiKey, distinct_id: core.distinctId });
        const r = await d.fetch(`${d.apiHost}/v1/guides?${q}`);
        if (!r.ok) return;
        const b = (await r.json()) as { guides?: MobileGuide[] };
        guides = Array.isArray(b.guides) ? b.guides : [];
      } catch {
        return;
      }
      if (screen !== undefined) svc.show(screen);
    },
    show(name) {
      screen = name;
      // no <LucidaGuides /> mounted: leave the guide unseen until one is
      if (view || !subs.size) return;
      // workflow-queued guides go first
      const g = [...guides.filter((x) => x.queued), ...guides.filter((x) => !x.queued)].find((x) => eligible(x, name));
      if (!g) return;
      if (g.preview) previewed.add(g.id);
      else {
        markSeen(g.id);
        void core.capture("$guide_shown", props(g));
      }
      present(g, 0);
    },
    current: () => view,
    subscribe(cb) {
      subs.add(cb);
      if (!view && screen !== undefined) svc.show(screen);
      return () => void subs.delete(cb);
    },
    setOpener(fn) {
      open = fn;
    },
    targetMissing() {
      if (!view?.anchor || view.guide.preview) return;
      const { guide: g, step: i, anchor } = view;
      const id = g.steps[i]!.id;
      void core.capture("$guide_target_missing", props(g, { guide_id: g.id, step_id: id, $guide_step_id: id, selector: anchor.nativeId }));
      set({ guide: g, step: i, buttons: view.buttons }); // the same step, unanchored
    },
    act(b) {
      if (!view) return;
      const { guide: g, step: i } = view;
      const quiet = !!g.preview;
      const step = g.steps[i]!;
      const sp = { $guide_step_id: step.id, $guide_step_index: i };
      const cap = (e: string, p: Props): void => {
        if (!quiet) void core.capture(e, p);
      };
      if (!b || b.action === "dismiss") {
        cap("$guide_dismissed", props(g, sp));
        return finish();
      }
      if (b.action === "back") return present(g, Math.max(i - 1, 0));
      if (b.action === "link" && b.url && /^https:\/\//i.test(b.url)) open(b.url);
      else if (b.action === "event" && b.event) cap(b.event, { $guide_id: g.id });
      cap("$guide_step", props(g, sp));
      if (i + 1 < g.steps.length && b.action !== "link") return present(g, i + 1);
      cap("$guide_completed", props(g));
      finish();
    },
  };
  return svc;
}

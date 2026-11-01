import type { Core, Props } from "@lucida/sdk-core";

const KINDS = ["modal", "banner", "announcement", "slideout", "tour"];
/** Targeting keys this engine honours; a guide using any other (non-empty) key is skipped, never shown to the wrong people. */
const HANDLED = ["url", "url_match", "flag_key", "sample_pct", "devices", "seen_guides", "not_seen_guides", "delay_seconds", "goal"];
const SEEN_KEY = "lc_guide_seen";

export interface GuideButton {
  label: string;
  /** next | dismiss | link | event (start_tour behaves like next on mobile). */
  action: string;
  url?: string;
  event?: string;
}

export interface GuideStep {
  id: string;
  title?: string | null;
  body?: string | null;
  buttons?: GuideButton[] | null;
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
}

/** What `<LucidaGuides />` draws. */
export interface GuideView {
  guide: MobileGuide;
  step: number;
  buttons: GuideButton[];
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
  return [{ label: i === g.steps.length - 1 ? "Done" : "Next", action: "next" }, { label: "Dismiss", action: "dismiss" }];
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
    if (g.preview) return !previewed.has(g.id);
    const c = g.conditions ?? {};
    if (seen.has(g.id) || !Object.keys(c).every((k) => unset(c[k]) || HANDLED.includes(k))) return false;
    const url = c["url"];
    if (typeof url === "string" && url && !matches(name, url, typeof c["url_match"] === "string" ? c["url_match"] : "contains")) return false;
    const f = c["flag_key"];
    if (typeof f === "string" && f && !d.flag(f)) return false;
    const pct = c["sample_pct"];
    if (typeof pct === "number" && random() * 100 >= pct) return false;
    if (!unset(c["devices"]) && !strs(c["devices"]).some((x) => x === "mobile" || x === "tablet")) return false;
    if (!unset(c["seen_guides"]) && !strs(c["seen_guides"]).every((x) => seen.has(x))) return false;
    if (!unset(c["not_seen_guides"]) && strs(c["not_seen_guides"]).some((x) => seen.has(x))) return false;
    return true;
  };

  const markSeen = (id: string): void => {
    seen.add(id);
    core.storage.set(SEEN_KEY, JSON.stringify([...seen].sort()));
  };

  const present = (g: MobileGuide, i: number): void => set({ guide: g, step: i, buttons: guideButtons(g, i) });

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
      const g = guides.find((x) => eligible(x, name));
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

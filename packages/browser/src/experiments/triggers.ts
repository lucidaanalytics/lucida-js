import type { Host } from "../types.js";

/** Payload key holding a web experiment's activation trigger (N-EXP-6; validated by lc-experiment). */
export const TRIGGER_KEY = "lc_trigger";

export type TriggerCondition =
  | { type: "time_on_page"; seconds: number }
  | { type: "time_in_session"; seconds: number }
  | { type: "pages_viewed"; count: number }
  | { type: "scroll"; percent: number }
  | { type: "exit_intent" }
  | { type: "element_visible"; selector: string }
  | { type: "custom_event"; event: string }
  /** Waits for `lucida.activateExperiment(flagKey)`. */
  | { type: "manual" }
  | TriggerGroup;

export interface TriggerGroup {
  op: "and" | "or";
  conditions: TriggerCondition[];
  /** The saved trigger it was copied from (informational). */
  saved_id?: string;
}

/** What the browser knows when a trigger is evaluated. */
export interface TriggerFacts {
  /** ms on this page (SPA navigations start a new page). */
  pageMs: number;
  /** ms since the session started. */
  sessionMs: number;
  /** Pages viewed in this session, the current one included. */
  pages: number;
  /** Deepest scroll on this page, 0..100. */
  scroll: number;
  exit: boolean;
  /** Whether an element matching the selector is (or was, on this page) in the viewport. */
  visible: (selector: string) => boolean;
  /** Events captured on this page. */
  events: ReadonlySet<string>;
  /** `activateExperiment` was called for this flag. */
  manual: boolean;
}

const MAX_DEPTH = 3;

/** The trigger of a flag payload, or undefined when it has none (or a malformed one). */
export function triggerOf(payload: unknown): TriggerGroup | undefined {
  const t = (payload as Record<string, unknown> | null | undefined)?.[TRIGGER_KEY] as TriggerGroup | undefined;
  return t && typeof t === "object" && (t.op === "and" || t.op === "or") && Array.isArray(t.conditions) && t.conditions.length ? t : undefined;
}

/** Whether `t` holds for `f`. Unknown condition types never match (a newer server, an older SDK). */
export function matches(t: TriggerCondition, f: TriggerFacts, depth = 0): boolean {
  if ("op" in t) {
    if (depth >= MAX_DEPTH || !Array.isArray(t.conditions) || !t.conditions.length) return false;
    return t.op === "and" ? t.conditions.every((c) => matches(c, f, depth + 1)) : t.conditions.some((c) => matches(c, f, depth + 1));
  }
  switch (t.type) {
    case "time_on_page":
      return f.pageMs >= t.seconds * 1000;
    case "time_in_session":
      return f.sessionMs >= t.seconds * 1000;
    case "pages_viewed":
      return f.pages >= t.count;
    case "scroll":
      return f.scroll >= t.percent;
    case "exit_intent":
      return f.exit;
    case "element_visible":
      return typeof t.selector === "string" && f.visible(t.selector);
    case "custom_event":
      return f.events.has(t.event);
    case "manual":
      return f.manual;
    default:
      return false;
  }
}

/** Live facts for trigger evaluation, plus which flags already activated in this session. */
export interface TriggerWatch {
  facts(key: string): TriggerFacts;
  /** Activated in this session: later pages apply at once. */
  fired(key: string): boolean;
  fire(key: string): void;
  /** `activateExperiment(key)`: the flag's trigger counts as matched. */
  activate(key: string): void;
  /** Sense time, scroll and exit intent only while some trigger waits. */
  sense(on: boolean): void;
  /** Called when a fact may have changed. */
  onChange(cb: () => void): void;
  dispose(): void;
}

const STATE_KEY = "lc_xp_trig";
const TICK_MS = 500;

function inViewport(sel: string): boolean {
  let els: Element[];
  try {
    els = [...document.querySelectorAll(sel)];
  } catch {
    return false; // a bad selector never matches
  }
  const h = window.innerHeight || document.documentElement.clientHeight;
  const w = window.innerWidth || document.documentElement.clientWidth;
  return els.some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < h && r.left < w;
  });
}

function scrollPct(): number {
  const d = document.documentElement;
  const total = Math.max(d.scrollHeight, document.body?.scrollHeight ?? 0);
  if (total <= window.innerHeight) return 100; // nothing to scroll: fully seen
  return Math.min(100, Math.round(((window.scrollY + window.innerHeight) / total) * 100));
}

/**
 * Facts for activation triggers. Page facts (time, scroll, exit intent, visible elements, events) reset on every
 * `$pageview`; the session's page count and activated flags are kept in SDK storage only after analytics consent
 * (memory before), and start over with a new session.
 */
export function triggerWatch(host: Host): TriggerWatch {
  const { core } = host;
  type State = { sid: string; pages: number; fired: string[] };
  const load = (): State => {
    try {
      const s = JSON.parse(core.storage.get(STATE_KEY) ?? "null") as State | null;
      if (s && s.sid === core.sessionId) return s;
    } catch {
      /* start over */
    }
    return { sid: core.sessionId, pages: 0, fired: [] };
  };
  let state = load();
  const save = (): void => {
    if (core.hasConsent("analytics")) core.storage.set(STATE_KEY, JSON.stringify(state));
  };
  const fresh = (): void => {
    if (state.sid !== core.sessionId) state = { sid: core.sessionId, pages: 0, fired: [] };
  };
  let pageStart = Date.now();
  let scroll = 0;
  let exit = false;
  const seen = new Set<string>();
  const events = new Set<string>();
  const manual = new Set<string>();
  const subs: Array<() => void> = [];
  const notify = (): void => subs.forEach((s) => s());

  host.onCapture((e) => {
    fresh();
    if (e.event === "$pageview") {
      pageStart = Date.now();
      scroll = 0;
      exit = false;
      seen.clear();
      events.clear();
      state.pages += 1;
      save();
    } else events.add(e.event);
    notify();
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  const onScroll = (): void => {
    scroll = Math.max(scroll, scrollPct());
    notify();
  };
  const onOut = (e: MouseEvent): void => {
    if (!e.relatedTarget && e.clientY <= 0) {
      exit = true; // pointer left through the top edge (towards tabs / the address bar); desktop only
      notify();
    }
  };
  const sense = (on: boolean): void => {
    if (on === (timer !== undefined)) return;
    if (on) {
      timer = setInterval(notify, TICK_MS);
      window.addEventListener("scroll", onScroll, { passive: true });
      document.addEventListener("mouseout", onOut);
      scroll = Math.max(scroll, scrollPct());
    } else {
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mouseout", onOut);
    }
  };

  return {
    facts(key) {
      fresh();
      const now = Date.now();
      return {
        pageMs: now - pageStart,
        sessionMs: now - (core.sessionStart ?? pageStart),
        pages: Math.max(1, state.pages),
        scroll,
        exit,
        visible: (sel) => {
          if (!seen.has(sel) && inViewport(sel)) seen.add(sel);
          return seen.has(sel);
        },
        events,
        manual: manual.has(key),
      };
    },
    fired(key) {
      fresh();
      return state.fired.includes(key);
    },
    fire(key) {
      fresh();
      if (state.fired.includes(key)) return;
      state.fired.push(key);
      save();
    },
    activate(key) {
      manual.add(key);
      notify();
    },
    sense,
    onChange: (cb) => void subs.push(cb),
    dispose: () => sense(false),
  };
}

import { claim } from "../arbiter.js";
import { eligible } from "../targeting.js";
import type { Props, Storage } from "@lucida/sdk-core";
import type { Guide, Host, Module } from "../types.js";
import { heldOut, variantOf } from "./ab.js";
import { showChangelog } from "./changelog.js";
import { localize } from "./locale.js";
import { guideState } from "./progress.js";
import { GUIDE_KEYS, SEEN_KEY, guideSync } from "./sync.js";
import { renderGuide, type GuideHandle, type GuideHooks } from "./render.js";

export { renderGuide } from "./render.js";

const LAST_KEY = "lc_guide_last";
/** Kinds that stay on the page until closed (loaded lazily, see persistent.ts). */
const PERSISTENT = new Set(["hotspot", "beacon", "badge", "launcher"]);
/** Shown alongside anything else (no arbiter claim): the persistent kinds and inline content. */
const unclaimed = (g: Guide): boolean => PERSISTENT.has(g.kind) || g.kind === "inline";
/** Kinds that resume on the next page until finished. */
const RESUMABLE = new Set(["tour", "checklist"]);
const SESSION_MS = 30 * 60_000;

const deviceOf = (): "desktop" | "mobile" | "tablet" => {
  const w = innerWidth;
  return w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
};

/**
 * Guides module (LC-ENG-4, 10-14, 16-20): GET /v1/guides after consent (the gateway applies cohort
 * targeting for ?distinct_id), client targeting (url, flag, sampling, wait_days, devices, person and
 * group attributes, seen guides, schedule, frequency), A/B variant and holdout, at most one modal-style
 * guide on screen (arbiter) plus any persistent hotspot/beacon/badge/launcher, then a shadow-DOM render
 * in the visitor's locale. Tours and checklists resume on the next page; checklist items tick
 * themselves from `complete_on` events. Inline guides wait for their element; resource-center
 * modules can open other guides. A `preview` guide (a draft served to one of its QA users) skips
 * targeting, shows once per page load and sends no events, so QA never reaches the results. config.guides.render === false leaves display to the host app.
 * Events: $guide_shown, $guide_step ($guide_step_id/_index: step reached; checklist item done),
 * $guide_completed, $guide_dismissed, $guide_holdout (control group), all carrying $guide_id.
 */
export const guides: Module = (host: Host) => {
  const { core } = host;
  let list: Guide[] = [];
  let gone = false;
  const active = new Set<string>();
  const handles = new Map<string, GuideHandle>();
  // Local changes to guide keys are pushed to the server copy (G55); the consent-gated storage stays the source of truth.
  const store: Storage = {
    get: (k) => core.storage.get(k),
    set(k, v) {
      core.storage.set(k, v);
      if (GUIDE_KEYS.includes(k)) sync.touch();
    },
    remove: (k) => core.storage.remove(k),
  };
  const sync = guideSync(host, core.storage);
  const readSeen = (): string[] => JSON.parse(store.get(SEEN_KEY) ?? "[]") as string[];
  const seen = new Set<string>(readSeen());
  const state = guideState(store);
  const teardowns = new Set<() => void>();
  const timers: ReturnType<typeof setTimeout>[] = [];
  // Person / group attributes the page told us about (identify $set, group(type, key, props)); memory only.
  const seed = host.config.localFlagsContext;
  const person: Props = { ...seed?.person_properties };
  const groups: Record<string, Props> = { ...seed?.group_properties };

  const flagOn = (k: string): boolean => {
    const v = host.flags?.get(k);
    return v !== undefined && v !== false;
  };
  const props = (g: Guide, extra: Props = {}) => ({ $guide_id: g.id, $guide_kind: g.kind, ...extra });
  const key = (): string => core.distinctId || core.sessionId;

  const previewed = new Set<string>();
  const hooksFor = (g: Guide, resumed = false): GuideHooks => {
    if (g.preview) {
      const noop = (): void => {};
      return { shown: noop, step: noop, completed: noop, dismissed: noop, event: noop };
    }
    const persistent = PERSISTENT.has(g.kind);
    const close = (): void => {
      state.tour.set(g.id, undefined);
      state.checked.set(g.id, undefined);
      if (persistent) state.dismissed.set(g.id, Date.now());
    };
    return {
      shown() {
        const now = Date.now();
        const views = state.views.get(g.id) ?? [];
        // a persistent guide re-renders on every page: report it once per (rough) session
        const repeat = persistent && (views.at(-1) ?? 0) > now - SESSION_MS;
        seen.add(g.id);
        store.set(SEEN_KEY, JSON.stringify([...seen]));
        core.storage.set(LAST_KEY, String(now));
        if (g.kind === "checklist" && !state.checked.get(g.id)) state.checked.set(g.id, []);
        if (repeat || resumed) return; // resuming a tour / checklist is not a new view
        state.views.set(g.id, [...views, now].slice(-50));
        core.capture("$guide_shown", props(g));
      },
      step: (i, id) => {
        if (g.kind === "checklist") state.checked.set(g.id, [...new Set([...(state.checked.get(g.id) ?? []), id])]);
        core.capture("$guide_step", props(g, { $guide_step_id: id, $guide_step_index: i }));
      },
      progress: (id) => g.kind === "tour" && state.tour.set(g.id, id),
      completed: () => (close(), core.capture("$guide_completed", props(g))),
      dismissed: (i, id) => (close(), core.capture("$guide_dismissed", props(g, { $guide_step_id: id, $guide_step_index: i }))),
      event: (name) => host.client.capture(name, { $guide_id: g.id }),
    };
  };

  const show = (g: Guide, start = 0): void => {
    const persistent = PERSISTENT.has(g.kind);
    const release = unclaimed(g) ? () => {} : claim();
    if (!release) return void active.delete(g.id); // another engagement is already open
    const lg = localize(g, [host.config.guides?.locale, person.locale as string | undefined, navigator.language]);
    const launch = (id: string): void => {
      const x = list.find((y) => y.id === id);
      if (x && !active.has(x.id)) (active.add(x.id), show(x));
    };
    const opts = { start, person, checked: state.checked.get(g.id) ?? [], library: list, launch, ...(host.config.nonce ? { nonce: host.config.nonce } : {}) };
    const resumed = start > 0 || (g.kind === "checklist" && state.checked.get(g.id) !== undefined);
    const finished = (): void => {
      teardowns.delete(stop);
      handles.delete(g.id);
      release();
      active.delete(g.id);
    };
    let stop: () => void = () => {};
    if (persistent) {
      // lazy: the persistent renderers are a separate chunk, fetched only when such a guide is live
      void import("./persistent.js").then((m) => {
        stop = m.renderPersistent(lg, hooksFor(g, resumed), finished, opts);
        if (gone) stop();
        else teardowns.add(stop);
      });
      return;
    }
    const handle = renderGuide(lg, hooksFor(g, resumed), finished, opts);
    stop = handle;
    handles.set(g.id, handle);
    teardowns.add(stop);
  };

  /** Targeting, A/B pick and holdout for one guide; true = show it now. */
  const admit = (g: Guide): boolean => {
    const persistent = PERSISTENT.has(g.kind);
    const c = g.conditions;
    const anchor = g.steps[0]?.selector;
    if (g.kind === "inline" && !(anchor && document.querySelector(anchor))) return false; // waits for its element
    if (g.preview) return !previewed.has(g.id) && (previewed.add(g.id), true);
    const views = state.views.get(g.id) ?? [];
    if (persistent ? state.dismissed.get(g.id) : seen.has(g.id) && !c.frequency) return false;
    const ctx = {
      url: location.href,
      flags: flagOn,
      flagValue: (k: string) => host.flags?.get(k),
      lastShownMs: Number(core.storage.get(LAST_KEY)) || undefined,
      nowMs: Date.now(),
      random: Math.random,
      person,
      groups,
      device: deviceOf(),
      seen: (id: string) => seen.has(id),
      views: persistent ? [] : views,
    };
    if (!eligible(g, ctx)) return false;
    if (variantOf(g, list, key()) !== g) return false; // another A/B variant is this person's
    if (heldOut(g, key())) {
      if (!state.held.get(g.id)) {
        state.held.set(g.id, Date.now());
        core.capture("$guide_holdout", props(g, c.ab_group ? { $guide_group: c.ab_group } : {}));
      }
      return false;
    }
    return true;
  };

  const evaluate = (): void => {
    if (host.config.guides?.render === false || typeof document === "undefined") return;
    // a tour / checklist in progress resumes, on the page its step lives on
    for (const g of list) {
      if (active.has(g.id) || !RESUMABLE.has(g.kind)) continue;
      const at = g.kind === "tour" ? g.steps.findIndex((s) => s.id === state.tour.get(g.id)) : state.checked.get(g.id) ? 0 : -1;
      const step = g.steps[at];
      if (at < 0 || !step || (step.url && !location.href.includes(step.url))) continue;
      active.add(g.id);
      return show(g, at);
    }
    for (const g of list) {
      if (active.has(g.id) || !unclaimed(g) || !admit(g)) continue;
      active.add(g.id);
      show(g);
    }
    for (const g of list) {
      if (active.has(g.id) || unclaimed(g) || !admit(g)) continue;
      active.add(g.id);
      timers.push(setTimeout(() => show(g), (g.conditions.delay_seconds ?? 0) * 1000));
      return; // one at a time; the next waits for a later evaluation
    }
  };

  /** Checklist items finish themselves when their `complete_on` event is captured. */
  const autoComplete = (e: { event: string; properties: Props }): void => {
    for (const g of list) {
      if (g.kind !== "checklist" || (!active.has(g.id) && !state.checked.get(g.id))) continue;
      for (const [i, s] of g.steps.entries()) {
        const on = s.complete_on;
        if (!on || on.event !== e.event || !Object.entries(on.props ?? {}).every(([k, v]) => e.properties[k] === v)) continue;
        const done = state.checked.get(g.id) ?? [];
        if (done.includes(s.id)) continue;
        const h = handles.get(g.id);
        if (h) h.markDone(s.id);
        else {
          // not on screen right now: record the progress so the list resumes with the item ticked
          state.checked.set(g.id, [...done, s.id]);
          core.capture("$guide_step", props(g, { $guide_step_id: s.id, $guide_step_index: i, $guide_auto: true }));
          if (done.length + 1 >= g.steps.length) hooksFor(g).completed();
        }
      }
    }
  };

  const load = (): void => {
    const guidesReq = host
      .fetch(`${host.config.apiHost}/v1/guides?api_key=${encodeURIComponent(host.apiKey)}${core.distinctId ? `&distinct_id=${encodeURIComponent(core.distinctId)}` : ""}`, { credentials: "omit" })
      .then((r) => (r.ok ? (r.json() as Promise<{ guides?: Guide[] }>) : Promise.reject(new Error(`status ${r.status}`))));
    // the server-side state (progress, dismissals, seen) is merged in before anything is evaluated
    Promise.all([guidesReq, sync.pull()])
      .then(([j]) => {
        for (const id of readSeen()) seen.add(id);
        list = j.guides ?? [];
        evaluate();
      })
      .catch((e) => host.log("guides fetch failed", e));
  };

  host.guides = {
    showChangelog() {
      if (typeof document === "undefined") return 0;
      const release = claim();
      if (!release) return 0;
      const stop = showChangelog(list, () => core.capture("$changelog_viewed"), () => (teardowns.delete(stop!), release()), host.config.nonce);
      if (!stop) {
        release();
        return 0;
      }
      teardowns.add(stop);
      return list.filter((g) => g.kind === "banner").length;
    },
    show(id) {
      const g = list.find((x) => x.id === id);
      if (!g || active.has(g.id) || typeof document === "undefined" || host.config.guides?.render === false) return false;
      active.add(g.id);
      show(g);
      return active.has(g.id); // show() releases it again when the arbiter refused
    },
    reset(id) {
      seen.delete(id);
      store.set(SEEN_KEY, JSON.stringify([...seen]));
      for (const m of [state.views, state.dismissed, state.tour, state.checked, state.held] as Array<{ set(k: string, v: undefined): void }>) m.set(id, undefined);
    },
  };
  host.whenConsented(load);
  host.onCapture((e) => {
    if (e.event === "$identify") load(); // who they are changed: cohorts and attributes too
    if (e.$set) Object.assign(person, e.$set);
    if (e.event === "$groupidentify") {
      const t = String(e.properties.$group_type);
      groups[t] = { ...groups[t], ...(e.properties.$group_set as Props) };
    }
    if (e.event === "$pageview") evaluate(); // SPA navigation can make a guide eligible
    else if (!e.event.startsWith("$guide_")) autoComplete(e);
  });
  return () => {
    gone = true;
    sync.stop();
    for (const t of timers) clearTimeout(t);
    for (const s of [...teardowns]) s();
  };
};

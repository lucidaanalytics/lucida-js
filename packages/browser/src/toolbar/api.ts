import type { Guide, GuideStep, Host } from "../types.js";

/** Session derived from the POST /v1/toolbar/exchange response (contract: sdks/browser/README.md). */
export interface ToolbarSession {
  session_token: string;
  project_id: string;
  expires_at?: string;
  permissions?: string[];
  user?: { email?: string };
}

/** One alternative of an action (lc_query `ActionStep`): every set field must match. */
export interface ActionStep {
  event?: string;
  selector?: string;
  text?: string;
  text_match?: "exact" | "contains";
  href?: string;
  href_match?: "exact" | "contains";
  url?: string;
  url_match?: "exact" | "contains" | "regex";
}

/** Visual event definition: the action matches when any step (picked element) does. */
export interface ActionDraft {
  name: string;
  steps: ActionStep[];
}

export interface SavedAction extends ActionDraft {
  id: string;
}

export type HeatType = "click" | "rage" | "dead" | "move" | "scroll";

/** `GET /heatmaps` for click/rage/dead/move: binned page coordinates. */
export interface HeatBins {
  bins: Array<{ x: number; y: number; count: number; sessions: number }>;
  total: number;
  max: number;
  x_bins: number;
  y_bin_px: number;
}
/** `GET /heatmaps?type=scroll`: share of sessions reaching each 10% of the page. */
export interface ScrollReach {
  sessions: number;
  reach: Array<{ depth_pct: number; sessions: number }>;
}
export interface HeatElement {
  selector: string;
  clicks: number;
  rage_clicks: number;
  dead_clicks: number;
  click_share: number | null;
}
export interface ElementPage {
  key: "selector" | "href";
  data: HeatElement[];
  next_cursor: string | null;
}
export interface ToolbarFlag {
  key: string;
  variants?: Array<{ key: string }>;
}

/** The experiment fields the visual editor reads and writes (GET/PATCH /experiments/{id}). */
export interface EditorExperiment {
  id: string;
  name: string;
  status: string;
  variants: Array<{ key: string; allocation_pct: number; payload?: Record<string, unknown> }>;
}

/** Guide document as the lc-api guides routes accept it (POST/PUT /guides). */
export interface GuideDoc {
  name: string;
  kind: Guide["kind"];
  steps: GuideStep[];
  targeting?: Record<string, unknown>;
}
export interface SavedGuide extends GuideDoc {
  id: string;
  status?: string;
}

/** Scope the guide builder needs. */
export const GUIDE_SCOPE = "guides:write";
/** Scope the experiment visual editor needs (LC-EXT-37). */
export const EXPERIMENT_SCOPE = "experiments:write";
/** `?__lc_edit=<experiment id>` opens the visual editor for that experiment (with a toolbar token). */
export const EDIT_PARAM = "__lc_edit";

export const TOOLBAR_PARAM = "__lc_toolbar";

/** Exchange the one-time `?__lc_toolbar=<token>` for a short-lived session. null = rejected. */
/** Where the toolbar talks to the Lucida API: `uiHost` when ingestion goes through a reverse proxy that only forwards capture. */
export const toolbarHost = (host: Host): string => (host.config.uiHost ?? host.config.apiHost ?? "").replace(/\/+$/, "");

export async function exchangeToken(host: Host, token: string): Promise<ToolbarSession | null> {
  try {
    const r = await host.fetch(`${toolbarHost(host)}/v1/toolbar/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ token, origin: location.origin }),
    });
    if (!r.ok) return null;
    const b = (await r.json()) as { token: string; project_id: string; scopes: string[]; expires_at: string };
    return { session_token: b.token, project_id: b.project_id, expires_at: b.expires_at, permissions: b.scopes };
  } catch {
    return null;
  }
}

/** Authenticated calls with the session bearer token. Failures resolve to null. */
export function toolbarApi(host: Host, s: ToolbarSession) {
  const base = `${toolbarHost(host)}/v1/projects/${encodeURIComponent(s.project_id)}`;
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T | null> => {
    try {
      const r = await host.fetch(base + path, {
        ...init,
        credentials: "omit",
        headers: { Authorization: `Bearer ${s.session_token}`, "Content-Type": "application/json" },
      });
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const heatQ = (path: string, viewport: string) => `url=${encodeURIComponent(path)}&viewport=${viewport}`;
  return {
    scopes: s.permissions ?? [],
    createAction: (a: ActionDraft) => call<SavedAction>("/actions", { method: "POST", body: JSON.stringify(a) }),
    updateAction: (id: string, a: ActionDraft) =>
      call<SavedAction>(`/actions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(a) }),
    /** Resolves true when the server deleted it (204 has no body). */
    deleteAction: async (id: string): Promise<boolean> => {
      try {
        const r = await host.fetch(`${base}/actions/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "omit",
          headers: { Authorization: `Bearer ${s.session_token}` },
        });
        return r.ok;
      } catch {
        return false;
      }
    },
    /** Store the element screenshot of an action (PNG); true when saved. */
    putActionScreenshot: async (id: string, png: Blob): Promise<boolean> => {
      try {
        const r = await host.fetch(`${base}/actions/${encodeURIComponent(id)}/screenshot`, {
          method: "PUT",
          credentials: "omit",
          headers: { Authorization: `Bearer ${s.session_token}`, "Content-Type": "image/png" },
          body: png,
        });
        return r.ok;
      } catch {
        return false;
      }
    },
    listActions: () => call<{ data: SavedAction[] }>("/actions?limit=200").then((r) => r?.data ?? []),
    flags: () => call<{ data: ToolbarFlag[] }>("/flags?limit=200").then((r) => r?.data ?? []),
    /** `path` is the page path (or a `*` pattern); the server bins by its normalized path. */
    heat: (path: string, viewport: string, type: Exclude<HeatType, "scroll">) =>
      call<HeatBins>(`/heatmaps?${heatQ(path, viewport)}&type=${type}`),
    scroll: (path: string, viewport: string) => call<ScrollReach>(`/heatmaps?${heatQ(path, viewport)}&type=scroll`),
    elements: (path: string, viewport: string, cursor?: string | null, byHref = false) =>
      call<ElementPage>(
        `/heatmaps/elements?${heatQ(path, viewport)}&limit=50${byHref ? "&key=href" : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    listGuides: () => call<{ data: SavedGuide[] }>("/guides?limit=100").then((r) => r?.data ?? []),
    createGuide: (g: GuideDoc) => call<SavedGuide>("/guides", { method: "POST", body: JSON.stringify(g) }),
    updateGuide: (id: string, g: GuideDoc) =>
      call<SavedGuide>(`/guides/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(g) }),
    experiment: (id: string) => call<EditorExperiment>(`/experiments/${encodeURIComponent(id)}`),
    /** Draft experiments only (the API answers 409 once it runs). */
    saveVariants: (id: string, variants: EditorExperiment["variants"]) =>
      call<EditorExperiment>(`/experiments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ variants }) }),
    /** Point-and-click goal: click action + proportion metric attached to the experiment. */
    addGoal: (id: string, g: { name: string; selector: string; text?: string; url?: string; role?: "primary" | "secondary" }) =>
      call<{ metric_id: string }>(`/experiments/${encodeURIComponent(id)}/goals`, { method: "POST", body: JSON.stringify(g) }),
  };
}

export type ToolbarApi = ReturnType<typeof toolbarApi>;

const OVERRIDE_KEY = "lc_flag_overrides";

/** Local (this browser only) flag overrides, honoured by the flags module. */
export function setFlagOverride(key: string, value: boolean | string | null): void {
  const o = getFlagOverrides();
  if (value === null) delete o[key];
  else o[key] = value;
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o));
  } catch {
    /* storage blocked: override lasts until reload only */
  }
}

export function getFlagOverrides(): Record<string, boolean | string> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? "{}") as Record<string, boolean | string>;
  } catch {
    return {};
  }
}

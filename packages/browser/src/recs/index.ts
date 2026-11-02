import type { FlagValue, Host, Module } from "../types.js";

/** Payload key that switches a placement's strategy for a flag value (A/B test strategies via flags / experiments). */
export const RECS_PAYLOAD_KEY = "lc_recs";
const RECENT_KEY = "lc_recs_recent";
const MAX_RECENT = 20;

/** One recommended item (from the project's catalog). */
export interface RecommendationItem {
  item_id: string;
  name: string;
  url?: string | null;
  image_url?: string | null;
  price?: number | null;
  category?: string | null;
  score: number;
}

export interface RecommendationOptions {
  /** The item on screen (product page): its neighbours are recommended and it is left out. */
  itemId?: string;
  limit?: number;
  /** Item ids never to show (e.g. the cart). */
  exclude?: string[];
  /** Flag whose payload `lc_recs` configures this placement; default: any flag payload naming the placement. */
  flag?: string;
  /** Capture `$recommendation_shown` when the result arrives (default true); false = call `shown()` yourself on render. */
  autoShown?: boolean;
}

export interface Recommendations {
  placement: string;
  strategy: string;
  items: RecommendationItem[];
  /** The flag and value that chose the strategy, when one did. */
  flag?: string;
  variant?: FlagValue;
  /** Capture `$recommendation_shown` (once). */
  shown(): void;
  /** Capture `$recommendation_clicked` for one item. */
  clicked(itemId: string): void;
}

export interface RecsService {
  get(placement: string, opts?: RecommendationOptions): Promise<Recommendations>;
  /** Record a viewed item for "recently viewed" (done automatically for the configured view event). */
  viewed(itemId: string): void;
}

interface PayloadConfig {
  placement?: string;
  strategy?: string;
  limit?: number;
}

/** The flag (and its payload config) that configures `placement`: `opts.flag`, else the first flag payload naming it. */
export function placementFlag(
  placement: string,
  payload: (k: string) => unknown,
  keys: string[],
  only?: string,
): { flag: string; cfg: PayloadConfig } | undefined {
  for (const k of only ? [only] : keys) {
    const cfg = (payload(k) as Record<string, unknown> | null | undefined)?.[RECS_PAYLOAD_KEY] as PayloadConfig | undefined;
    if (cfg && typeof cfg === "object" && (cfg.placement === placement || (only !== undefined && cfg.placement === undefined))) return { flag: k, cfg };
  }
  return undefined;
}

/**
 * Product recommendations (N-EXP-17): `client.recommendations(placement, opts)` reads GET /v1/recommendations
 * (public key) for a placement configured in Lucida, and returns catalog items ranked by the placement's strategy
 * (popular, trending, viewed with, bought with, recently viewed). A flag or experiment variant payload
 * `{"lc_recs": {"placement": "pdp", "strategy": "bought_with", "limit": 6}}` switches the strategy for its audience
 * (reading it records the `$exposure`). Recently viewed items (from `recommendations.viewEvent`, default
 * `$product_viewed` with `item_id`) are kept in SDK storage only after analytics consent and sent only then.
 */
export const recommendations: Module = (host: Host) => {
  const { core } = host;
  const cfg = host.config.recommendations ?? {};
  const viewEvent = cfg.viewEvent ?? "$product_viewed";
  const idProp = cfg.itemIdProperty ?? "item_id";
  let recent: string[] = [];
  try {
    const raw = JSON.parse(core.storage.get(RECENT_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) recent = raw.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT);
  } catch {
    /* start empty */
  }
  const consented = (): boolean => core.hasConsent("analytics");
  const viewed = (id: string): void => {
    if (!id) return;
    recent = [id, ...recent.filter((x) => x !== id)].slice(0, MAX_RECENT);
    if (consented()) core.storage.set(RECENT_KEY, JSON.stringify(recent));
  };
  host.onCapture((e) => {
    const id = e.properties?.[idProp];
    if (e.event === viewEvent && (typeof id === "string" || typeof id === "number")) viewed(String(id));
  });

  host.recs = {
    viewed,
    async get(placement, opts = {}) {
      const keys = Object.keys(host.flags?.all() ?? {});
      const hit = placementFlag(placement, (k) => host.flags?.payload(k), keys, opts.flag);
      const variant = hit ? host.flags?.get(hit.flag) : undefined; // records the $exposure
      const q = new URLSearchParams({ api_key: host.apiKey, placement });
      if (opts.itemId) q.set("item_id", opts.itemId);
      if (consented() && recent.length) q.set("recent", recent.filter((r) => r !== opts.itemId).slice(0, 10).join(","));
      const strategy = hit?.cfg.strategy;
      if (typeof strategy === "string") q.set("strategy", strategy);
      const limit = opts.limit ?? hit?.cfg.limit;
      if (typeof limit === "number" && limit > 0) q.set("limit", String(Math.min(50, Math.floor(limit))));
      if (opts.exclude?.length) q.set("exclude", opts.exclude.slice(0, 50).join(","));
      let body: { strategy?: string; items?: RecommendationItem[] } = {};
      try {
        const r = await host.fetch(`${host.config.apiHost}/v1/recommendations?${q}`, { credentials: "omit" });
        if (r.ok) body = (await r.json()) as typeof body;
        else host.log("recommendations failed", r.status);
      } catch (e) {
        host.log("recommendations failed", e);
      }
      const items = Array.isArray(body.items) ? body.items : [];
      const used = body.strategy ?? strategy ?? "";
      const base = {
        $recommendation_placement: placement,
        $recommendation_strategy: used,
        ...(hit ? { $recommendation_flag: hit.flag } : {}),
        ...(variant !== undefined ? { $recommendation_variant: String(variant) } : {}),
      };
      let didShow = false;
      const out: Recommendations = {
        placement,
        strategy: used,
        items,
        ...(hit ? { flag: hit.flag } : {}),
        ...(variant !== undefined ? { variant } : {}),
        shown() {
          if (didShow || !items.length) return;
          didShow = true;
          core.capture("$recommendation_shown", { ...base, $recommendation_items: items.map((i) => i.item_id) });
        },
        clicked(itemId) {
          const pos = items.findIndex((i) => i.item_id === itemId);
          core.capture("$recommendation_clicked", { ...base, $recommendation_item: itemId, ...(pos >= 0 ? { $recommendation_position: pos + 1 } : {}) });
        },
      };
      if (opts.autoShown !== false) out.shown();
      return out;
    },
  };
};

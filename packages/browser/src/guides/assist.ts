import type { Guide, Host } from "../types.js";
import type { AnswerResult, Assist } from "./modules.js";

// Resource-center AI help (N-DAP-12): the answer call to the gateway (publishable key, like GET /v1/guides) and
// the `$guide_search` event. The query text goes to the answer endpoint only; the event carries its length, unless
// the project turned on `guide_search_capture_query` (served with the guide list).

export const PERMALINK_PARAM = "lc_guide";

export function assistFor(host: Host, g: Guide, captureQuery: () => boolean, locale?: string): Assist {
  const { core } = host;
  return {
    async ask(query) {
      try {
        const r = await host.fetch(`${host.config.apiHost}/v1/guides/answer?api_key=${encodeURIComponent(host.apiKey)}`, {
          method: "POST",
          // text/plain keeps it a simple request (no preflight), like the guide-state call
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          credentials: "omit",
          body: JSON.stringify({ api_key: host.apiKey, query: query.slice(0, 500), distinct_id: core.distinctId || core.sessionId, url: location.href.slice(0, 2000), ...(locale ? { locale: locale.slice(0, 35) } : {}) }),
        });
        if (r.status === 503) return "unavailable";
        if (!r.ok) return null;
        const b = (await r.json()) as Partial<AnswerResult>;
        return {
          answer: typeof b.answer === "string" ? b.answer : "",
          citations: Array.isArray(b.citations) ? b.citations.filter((c) => c && typeof c.url === "string") : [],
          guide_ids: Array.isArray(b.guide_ids) ? b.guide_ids.filter((x): x is string => typeof x === "string") : [],
        };
      } catch (e) {
        host.log("guide answer failed", e);
        return null;
      }
    },
    searched({ query, results, answered, feedback }) {
      core.capture("$guide_search", {
        $guide_id: g.id,
        guide_id: g.id,
        query_length: query.length,
        results,
        answered,
        ...(feedback ? { feedback } : {}),
        ...(captureQuery() ? { query: query.slice(0, 500) } : {}),
      });
    },
  };
}

/** `?lc_guide=<id>` (N-DAP-5): read it and strip it from the address bar right away (no storage is written). */
export function takePermalink(): string | null {
  if (typeof location === "undefined" || typeof history === "undefined") return null;
  try {
    const u = new URL(location.href);
    const id = u.searchParams.get(PERMALINK_PARAM);
    if (!id) return null;
    u.searchParams.delete(PERMALINK_PARAM);
    history.replaceState(history.state, "", u.toString());
    return id.slice(0, 100);
  } catch {
    return null;
  }
}

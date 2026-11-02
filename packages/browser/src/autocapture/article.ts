import type { AutocaptureConfig, Host } from "../types.js";

const DEFAULT = '[data-lc-region="article"]';
/** Share of the article region that counts as read to the end. */
const FINISHED = 90;

/**
 * Article read-through (N-DXA-6): on a page with an article region (`data-lc-region="article"`, the
 * `autocapture.articleSelector` option, or `article_selector` from remote config) one `$article_read`
 * is sent when the reader leaves the page or SPA route: `$article_id` (`data-lc-article-id`, else the
 * path), `$article_depth` (0-100, how far down the region the viewport reached), `$article_finished`
 * (depth >= 90) and `$article_headline_exit` (the first heading never scrolled out of view and
 * under a quarter was seen). Reads geometry and two attributes only, never text.
 * `autocapture.articles: false` turns it off.
 */
export function startArticleCapture(host: Host, cfg: AutocaptureConfig, enabled: () => boolean): () => void {
  if (cfg.articles === false) return () => {};
  let remote: string | undefined;
  void host.loadConfig().then((r) => {
    if (typeof r?.article_selector === "string") remote = r.article_selector;
  });
  const find = (): Element | null => {
    for (const sel of [cfg.articleSelector, remote, DEFAULT]) {
      if (!sel) continue;
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch {
        // an invalid selector from config is skipped
      }
    }
    return null;
  };
  let url = location.href;
  let path = location.pathname;
  let el: Element | null = null;
  let depth = 0;
  let pastHeadline = false;

  const update = (): void => {
    el ??= find();
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    const seen = Math.round(Math.min(100, Math.max(0, ((window.innerHeight - r.top) / r.height) * 100)));
    depth = Math.max(depth, seen);
    const h = el.querySelector("h1,h2");
    if (h && h.getBoundingClientRect().bottom < 0) pastHeadline = true;
  };
  const send = (): void => {
    if (!el || !enabled()) return;
    update();
    host.client.capture("$article_read", {
      $article_id: (el.getAttribute("data-lc-article-id") ?? "").trim().slice(0, 200) || path,
      $article_depth: depth,
      $article_finished: depth >= FINISHED,
      $article_headline_exit: !pastHeadline && depth < 25,
    });
    el = null;
  };
  const reset = (): void => {
    send();
    el = null;
    depth = 0;
    pastHeadline = false;
    url = location.href;
    path = location.pathname;
  };
  // A route change sends the article that was left; SPA renders find the next region.
  const tick = (): void => (location.href !== url ? reset() : update());
  const mo = new MutationObserver(tick);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", tick, { passive: true });
  host.onUnload(send);
  update();
  return () => {
    mo.disconnect();
    window.removeEventListener("scroll", tick);
  };
}

import type { AutocaptureConfig, Host } from "../types.js";

const NAME = "data-lc-content";
const PIECE = "data-lc-content-piece";
const TARGET = "data-lc-content-target";
const MAX = 200;

const attr = (el: Element, a: string): string => (el.getAttribute(a) ?? "").trim().slice(0, MAX);

/**
 * Content blocks: elements the page marks with `data-lc-content="<name>"` (optionally
 * `data-lc-content-piece` and `data-lc-content-target`) send `$content_impression` once per page when at
 * least half of them has been on screen, and `$content_interaction` on click. Only those attributes are
 * read, never the element's text or any input value. `autocapture.contentBlocks: false` turns it off.
 */
export function startContentCapture(host: Host, cfg: AutocaptureConfig, enabled: () => boolean): () => void {
  if (cfg.contentBlocks === false || typeof IntersectionObserver === "undefined") return () => {};
  const seen = new WeakSet<Element>();
  const props = (el: Element): Record<string, string> => {
    const out: Record<string, string> = { $content_name: attr(el, NAME) };
    const piece = attr(el, PIECE);
    const target = attr(el, TARGET);
    if (piece) out.$content_piece = piece;
    if (target) out.$content_target = target;
    return out;
  };
  let url = location.href;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || seen.has(e.target) || !enabled()) continue;
        seen.add(e.target);
        host.client.capture("$content_impression", props(e.target));
      }
    },
    { threshold: 0.5 },
  );
  const watch = (root: ParentNode): void => root.querySelectorAll(`[${NAME}]`).forEach((el) => io.observe(el));
  watch(document);
  // New blocks (SPA renders) are picked up; a route change makes every block countable again.
  const mo = new MutationObserver(() => {
    if (location.href !== url) {
      url = location.href;
      io.disconnect();
      document.querySelectorAll(`[${NAME}]`).forEach((el) => seen.delete(el));
    }
    watch(document);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  const click = (ev: Event): void => {
    const el = (ev.target as Element | null)?.closest?.(`[${NAME}]`);
    if (el && enabled()) host.client.capture("$content_interaction", { ...props(el), $content_interaction_type: "click" });
  };
  document.addEventListener("click", click, true);
  return () => {
    io.disconnect();
    mo.disconnect();
    document.removeEventListener("click", click, true);
  };
}

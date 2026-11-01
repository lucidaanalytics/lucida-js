import type { AutocaptureConfig, Client, Host } from "../types.js";

const IGNORE = "[data-lc-ignore]";
export const DOWNLOAD_EXTENSIONS = [
  "pdf", "zip", "gz", "tar", "rar", "7z", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "epub",
  "dmg", "exe", "msi", "pkg", "apk", "iso", "mp3", "mp4", "mov",
];
export const SEARCH_PARAMS = ["q", "s", "search", "query"];

/** Query and hash are dropped: destination URLs often carry tokens. */
const bare = (u: URL): string => u.origin + u.pathname;

/**
 * `$outbound_click` (link to another host), `$file_download` (download attribute or a listed
 * extension) and `$site_search` (a search query param on the landing URL, incl. SPA routes).
 * Each is on unless its toggle is false; nothing here reads input values.
 */
export function startLinkCapture(host: Host, cfg: AutocaptureConfig, enabled: () => boolean): () => void {
  const exts = Array.isArray(cfg.fileDownloads) ? cfg.fileDownloads.map((e) => e.toLowerCase()) : DOWNLOAD_EXTENSIONS;
  const stops: Array<() => void> = [];

  if (cfg.outboundLinks !== false || cfg.fileDownloads !== false) {
    const onClick = (ev: MouseEvent): void => {
      const a = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
      if (!a || !enabled() || a.closest(IGNORE)) return;
      let u: URL;
      try {
        u = new URL((a as HTMLAnchorElement).href, location.href);
      } catch {
        return;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      const file = decodeURIComponent(u.pathname.split("/").pop() ?? "");
      const ext = file.includes(".") ? file.split(".").pop()!.toLowerCase() : "";
      if (cfg.fileDownloads !== false && (a.hasAttribute("download") || exts.includes(ext))) {
        host.client.capture("$file_download", { $url: bare(u), $file_name: file, $file_extension: ext });
      } else if (cfg.outboundLinks !== false && u.host !== location.host) {
        host.client.capture("$outbound_click", { $url: bare(u), $outbound_host: u.host });
      }
    };
    document.addEventListener("click", onClick, true);
    stops.push(() => document.removeEventListener("click", onClick, true));
  }

  if (cfg.siteSearch !== false) {
    const params = typeof cfg.siteSearch === "object" && cfg.siteSearch.params ? cfg.siteSearch.params : SEARCH_PARAMS;
    let live = true;
    stops.push(() => void (live = false));
    host.onCapture((e) => {
      if (!live || e.event !== "$pageview" || !enabled()) return;
      const q = new URLSearchParams(location.search);
      for (const p of params) {
        const term = q.get(p)?.trim();
        if (term) return void host.client.capture("$site_search", { $search_term: term.slice(0, 200), $search_param: p });
      }
    });
  }
  return () => stops.forEach((s) => s());
}

/** Call from the 404 page template: `$page_not_found` lets reports list dead URLs and their referrers. */
export function tag404(client: Pick<Client, "capture">, props: Record<string, string | number | boolean> = {}): void {
  client.capture("$page_not_found", { $status: 404, ...props });
}

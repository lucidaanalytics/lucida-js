/** A `<style>` element carrying the configured CSP nonce (the only way the SDK injects CSS). */
export function styleTag(css: string, nonce?: string): HTMLStyleElement {
  const s = document.createElement("style");
  if (nonce) s.setAttribute("nonce", nonce);
  s.textContent = css;
  return s;
}

/** The page's `<meta http-equiv="Content-Security-Policy">` policies (a header policy is invisible to scripts). */
function metaPolicies(): string[] {
  return Array.from(document.querySelectorAll("meta[http-equiv]"))
    .filter((m) => m.getAttribute("http-equiv")?.toLowerCase() === "content-security-policy")
    .map((m) => m.getAttribute("content") ?? "");
}

/** True when a policy restricts inline `<style>` (style-src-elem / style-src / default-src without 'unsafe-inline'). */
export function blocksInlineStyle(policy: string): boolean {
  const dirs = new Map<string, string[]>();
  for (const d of policy.split(";")) {
    const [name, ...src] = d.trim().toLowerCase().split(/\s+/);
    if (name && !dirs.has(name)) dirs.set(name, src);
  }
  const src = dirs.get("style-src-elem") ?? dirs.get("style-src") ?? dirs.get("default-src");
  // 'unsafe-inline' is ignored by browsers once a nonce or hash is listed.
  return !!src && !(src.includes("'unsafe-inline'") && !src.some((s) => s.startsWith("'nonce-") || s.startsWith("'sha")));
}

/**
 * Debug-mode doctor hint (logged, never sent): a meta CSP that blocks inline styles while no `nonce` is set, and any
 * style the browser then refuses. CSP violation reporting itself belongs to Watchtower.
 */
export function cspHint(log: (...a: unknown[]) => void, nonce: string | undefined): () => void {
  if (typeof document === "undefined") return () => {};
  if (!nonce && metaPolicies().some(blocksInlineStyle)) {
    log("CSP hint: this page's Content-Security-Policy blocks inline <style>; set the `nonce` option so guides and the experiment veil render (docs/guides/csp.md)");
  }
  const on = (e: Event): void => {
    const v = e as SecurityPolicyViolationEvent;
    if (/^style-src/.test(v.effectiveDirective ?? "") && v.blockedURI === "inline") {
      log(`CSP hint: an inline style was blocked by ${v.effectiveDirective}${nonce ? " (check that `nonce` matches the page's nonce)" : "; set the `nonce` option"}`);
    }
  };
  document.addEventListener("securitypolicyviolation", on);
  return () => document.removeEventListener("securitypolicyviolation", on);
}

const clip = (s: string, n: number): string => s.slice(0, n);

/** Origin + path of a URL (no query, no fragment); keywords such as `inline` and `eval` pass through. */
function bareUrl(u: string): string {
  try {
    const p = new URL(u);
    return p.protocol === "data:" || p.protocol === "blob:" ? p.protocol : p.origin + p.pathname;
  } catch {
    return clip(u, 64);
  }
}

export interface CspCaptureOptions {
  /** Most `$csp_violation` events per page load (default 20); identical ones (same directive, blocked URL, source) count once. */
  maxPerPage?: number;
}

/**
 * Opt-in `$csp_violation` events from the browser's `securitypolicyviolation` event. Only the directive, the blocked
 * URL and the offending source file as origin + path, the line and the disposition are sent: never query strings, the
 * code `sample` or the referrer. (A product signal for broken pages; the full report pipeline stays in Watchtower.)
 */
export function captureCspViolations(
  capture: (event: string, props: Record<string, unknown>) => void,
  opts: CspCaptureOptions = {},
): () => void {
  if (typeof document === "undefined") return () => {};
  const max = opts.maxPerPage ?? 20;
  const seen = new Set<string>();
  const on = (e: Event): void => {
    const v = e as SecurityPolicyViolationEvent;
    const props = {
      $csp_directive: v.effectiveDirective ?? v.violatedDirective,
      $csp_blocked_uri: bareUrl(v.blockedURI ?? ""),
      $csp_source_file: v.sourceFile ? bareUrl(v.sourceFile) : undefined,
      $csp_line: v.lineNumber || undefined,
      $csp_column: v.columnNumber || undefined,
      $csp_disposition: v.disposition,
    };
    const key = [props.$csp_directive, props.$csp_blocked_uri, props.$csp_source_file, props.$csp_line].join("|");
    if (seen.has(key) || seen.size >= max) return;
    seen.add(key);
    capture("$csp_violation", Object.fromEntries(Object.entries(props).filter(([, x]) => x !== undefined)));
  };
  document.addEventListener("securitypolicyviolation", on);
  return () => document.removeEventListener("securitypolicyviolation", on);
}

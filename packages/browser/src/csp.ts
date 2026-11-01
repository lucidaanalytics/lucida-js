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

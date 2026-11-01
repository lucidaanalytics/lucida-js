import type { ConsentCategory, ConsentState } from "@lucida/sdk-core";
import type { Host } from "../types.js";
import { applyConsent } from "./record.js";
import type { BannerOptions, BannerPosition, BannerTexts } from "./options.js";

const DEFAULT_TEXTS: BannerTexts = {
  title: "Your privacy",
  body: "We use cookies and similar technologies to measure and improve this site. Choose what you allow.",
  acceptAll: "Accept all",
  rejectAll: "Reject all",
  save: "Save choices",
  categories: { analytics: "Analytics", replay: "Session replay", marketing: "Marketing" },
};
const ALL: ConsentCategory[] = ["analytics", "replay", "marketing"];
const FOCUSABLE = "button, input, [href], [tabindex]:not([tabindex='-1'])";

const PLACE: Record<BannerPosition, Record<string, string>> = {
  bottom: { left: "0", right: "0", bottom: "0" },
  top: { left: "0", right: "0", top: "0" },
  center: { top: "50%", left: "50%", transform: "translate(-50%,-50%)", "max-width": "28rem" },
  "bottom-left": { left: "1rem", bottom: "1rem", "max-width": "24rem" },
  "bottom-right": { right: "1rem", bottom: "1rem", "max-width": "24rem" },
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: Node[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

let open: { root: HTMLElement; close(): void } | undefined;

export function hideBanner(): void {
  open?.close();
}

interface RemoteBanner {
  title?: string;
  body?: string;
  accept_label?: string;
  decline_label?: string;
  customize_label?: string;
  categories?: { id: string; label: string; required?: boolean }[];
  position?: string;
}

/** Map the project's `consent_banner` to banner options; ids the SDK has no consent category for are left out. */
export function fromRemote(b: RemoteBanner | undefined): BannerOptions {
  if (!b) return {};
  const cats = (b.categories ?? []).filter((c) => !c.required && (ALL as string[]).includes(c.id));
  const labels = Object.fromEntries(cats.map((c) => [c.id, c.label])) as Partial<BannerTexts["categories"]>;
  const texts = { title: b.title, body: b.body, acceptAll: b.accept_label, rejectAll: b.decline_label, save: b.customize_label, categories: labels };
  const pos = b.position?.replace("_", "-") as BannerPosition | undefined;
  return {
    texts: Object.fromEntries(Object.entries(texts).filter(([, v]) => v !== undefined)),
    ...(cats.length ? { categories: cats.map((c) => c.id as ConsentCategory) } : {}),
    ...(pos && pos in PLACE ? { position: pos } : {}),
  };
}

async function remoteOptions(host: Host): Promise<BannerOptions> {
  try {
    const r = await host.fetch(`${host.config.apiHost}/v1/config?api_key=${encodeURIComponent(host.apiKey)}`, { credentials: "omit" });
    return r.ok ? fromRemote(((await r.json()) as { consent_banner?: RemoteBanner }).consent_banner) : {};
  } catch {
    return {}; // the built-in copy still renders
  }
}

/** Show the banner; with `remote`, project settings fill whatever `opts` leaves out. */
export async function showBanner(host: Host, opts: BannerOptions = {}): Promise<ConsentState | null> {
  if (!opts.remote) return render(host, opts);
  const r = await remoteOptions(host);
  return render(host, { ...r, ...opts, texts: { ...r.texts, ...opts.texts, categories: { ...r.texts?.categories, ...opts.texts?.categories } } });
}

/**
 * Render the banner as an accessible dialog: ARIA labelled, Tab/Shift+Tab trapped inside, Escape dismisses
 * without storing anything, focus returns to where it was, and the fade is skipped under prefers-reduced-motion.
 * Text is set with textContent only (texts are data, never HTML).
 */
function render(host: Host, opts: BannerOptions): Promise<ConsentState | null> {
  hideBanner();
  const t: BannerTexts = { ...DEFAULT_TEXTS, ...opts.texts, categories: { ...DEFAULT_TEXTS.categories, ...opts.texts?.categories } };
  const cats = opts.categories ?? ALL;
  const state = host.core.getConsent();
  const pos = opts.position ?? "bottom";
  const id = `lc-consent-${Math.random().toString(36).slice(2, 8)}`;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const previous = document.activeElement as HTMLElement | null;

  const boxes = cats.map((c) => {
    const input = el("input", { type: "checkbox", id: `${id}-${c}`, checked: state[c] });
    return { c, input, row: el("label", { htmlFor: input.id }, input, document.createTextNode(` ${t.categories[c]}`)) };
  });
  const btn = (text: string, primary: boolean): HTMLButtonElement => {
    const b = el("button", { type: "button", textContent: text });
    b.style.cssText = `padding:.5rem 1rem;margin:.25rem .5rem .25rem 0;border:1px solid #1f2937;border-radius:.375rem;cursor:pointer;font:inherit;background:${primary ? "#1f2937" : "#fff"};color:${primary ? "#fff" : "#1f2937"}`;
    return b;
  };
  const accept = btn(t.acceptAll, true);
  const reject = btn(t.rejectAll, true);
  const save = btn(t.save, false);

  const root = el(
    "div",
    { role: "dialog", id },
    el("h2", { id: `${id}-t`, textContent: t.title }),
    el("p", { id: `${id}-d`, textContent: t.body }),
    ...(cats.length > 1 ? boxes.map((b) => b.row) : []),
    el("div", {}, accept, reject, ...(cats.length > 1 ? [save] : [])),
  );
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", `${id}-t`);
  root.setAttribute("aria-describedby", `${id}-d`);
  root.setAttribute("data-lc-ignore", "");
  root.style.cssText = "position:fixed;z-index:2147483000;box-sizing:border-box;padding:1rem 1.25rem;background:#fff;color:#111827;font:14px/1.4 system-ui,sans-serif;box-shadow:0 0 .75rem rgba(0,0,0,.3);display:block";
  for (const [k, v] of Object.entries(PLACE[pos])) root.style.setProperty(k, v);
  for (const h of root.querySelectorAll("h2")) h.style.cssText = "margin:0 0 .5rem;font-size:1.1rem";
  for (const l of root.querySelectorAll("label")) l.style.cssText = "display:block;margin:.25rem 0";
  if (!reduced) {
    root.style.opacity = "0";
    root.style.transition = "opacity .2s";
    requestAnimationFrame(() => (root.style.opacity = "1"));
  }

  return new Promise((resolve) => {
    const finish = (update: Partial<ConsentState> | null): void => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      open = undefined;
      previous?.focus?.();
      if (update) applyConsent(host, update, "banner", opts.version ? { version: opts.version } : {});
      resolve(update ? host.core.getConsent() : null);
    };
    const setAll = (v: boolean): Partial<ConsentState> => Object.fromEntries(cats.map((c) => [c, v]));
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") return void finish(null);
      if (e.key !== "Tab") return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const at = document.activeElement;
      if (!root.contains(at)) (e.shiftKey ? last : first).focus();
      else if (e.shiftKey && at === first) last.focus();
      else if (!e.shiftKey && at === last) first.focus();
      else return;
      e.preventDefault();
    };
    accept.onclick = () => finish(setAll(true));
    reject.onclick = () => finish(setAll(false));
    save.onclick = () => finish(Object.fromEntries(boxes.map((b) => [b.c, b.input.checked])));
    document.addEventListener("keydown", onKey, true);
    document.body.append(root);
    open = { root, close: () => finish(null) };
    accept.focus();
  });
}

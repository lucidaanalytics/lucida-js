import type { Guide, GuideStep } from "../types.js";

// Resource-center modules (LC-ENG-19), loaded on demand by the renderer: a list of other guides to
// start, the announcements feed, and help-doc search. Content is text only (never markup).

export interface ModuleCtx {
  /** The project's guides as served to this visitor. */
  library: Guide[];
  /** Close the resource center and open this guide. */
  launch(guideId: string): void;
  /** The visitor used this module ($guide_step). */
  opened(): void;
}

const LAUNCHABLE = new Set<Guide["kind"]>(["tour", "checklist", "modal", "slideout"]);
const ANNOUNCE = new Set<Guide["kind"]>(["announcement", "banner"]);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The guides a `guides` module lists: `guide_ids` in that order, else every launchable guide. */
export function listed(s: GuideStep, library: Guide[]): Guide[] {
  if (s.guide_ids?.length) return s.guide_ids.flatMap((id) => library.find((g) => g.id === id) ?? []);
  return library.filter((g) => LAUNCHABLE.has(g.kind));
}

/** Help-doc search URL for `q`, or null when the module has none (or it is not https). */
export function searchHref(s: GuideStep, q: string): string | null {
  if (!s.search_url || !q.trim()) return null;
  try {
    const u = new URL(s.search_url.replace("{q}", encodeURIComponent(q.trim())));
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Render one module item into a resource-center list entry. */
export function renderModule(s: GuideStep, ctx: ModuleCtx): HTMLElement {
  const box = el("section");
  box.setAttribute("aria-label", s.title ?? s.module ?? "Module");
  box.append(el("h2", s.title ?? ""));
  if (s.body) box.append(el("p", s.body));
  if (s.module === "guides") {
    const ul = el("ul");
    for (const g of listed(s, ctx.library)) {
      const b = el("button", g.name);
      b.type = "button";
      b.onclick = () => (ctx.opened(), ctx.launch(g.id));
      const li = el("li");
      li.append(b);
      ul.append(li);
    }
    box.append(ul.childElementCount ? ul : el("p", "No guides yet."));
  } else if (s.module === "announcements") {
    const items = ctx.library.filter((g) => ANNOUNCE.has(g.kind) && g.steps[0]).sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
    const ul = el("ul");
    for (const g of items.slice(0, 10)) {
      const li = el("li");
      li.append(el("strong", g.steps[0]!.title ?? g.name));
      if (g.steps[0]!.body) li.append(el("p", g.steps[0]!.body));
      ul.append(li);
    }
    box.append(ul.childElementCount ? ul : el("p", "Nothing new."));
  } else if (s.module === "search") {
    // the query is never captured: this shadow root is data-lc-ignore and nothing here sends events with it
    const form = el("form");
    form.setAttribute("role", "search");
    const label = el("label", "Search help");
    const input = el("input");
    input.type = "search";
    label.append(input);
    const go = el("button", "Search");
    go.type = "submit";
    const hits = el("ul");
    form.append(label, go, hits);
    form.onsubmit = (e) => {
      e.preventDefault();
      ctx.opened();
      const q = input.value.trim().toLowerCase();
      hits.replaceChildren();
      for (const g of ctx.library.filter((x) => LAUNCHABLE.has(x.kind) && q && (x.name + " " + x.steps.map((st) => `${st.title ?? ""} ${st.body ?? ""}`).join(" ")).toLowerCase().includes(q)).slice(0, 5)) {
        const b = el("button", g.name);
        b.type = "button";
        b.onclick = () => ctx.launch(g.id);
        const li = el("li");
        li.append(b);
        hits.append(li);
      }
      const href = searchHref(s, input.value);
      if (href) window.open(href, "_blank", "noopener,noreferrer");
    };
    box.append(form);
  }
  return box;
}

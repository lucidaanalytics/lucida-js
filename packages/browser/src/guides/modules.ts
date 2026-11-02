import type { Guide, GuideStep } from "../types.js";

// Resource-center modules (LC-ENG-19), loaded on demand by the renderer: a list of other guides to
// start, the announcements feed, and help-doc search with an optional AI answer (N-DAP-12: POST
// /v1/guides/answer over the project's public knowledge, cited links and suggested guides). Content is
// text only (never markup).

/** `POST /v1/guides/answer` response. */
export interface AnswerResult {
  answer: string;
  citations: Array<{ title: string; url: string }>;
  guide_ids: string[];
}

/** The resource center's AI help: the guides module wires it to the gateway and to `$guide_search`. */
export interface Assist {
  /** "unavailable" = no LLM configured (503): the answer box hides and plain search stays. null = failed this time. */
  ask(query: string): Promise<AnswerResult | "unavailable" | null>;
  /** One search, and later its answer feedback. The query text is passed for the opt-in project setting only. */
  searched(p: { query: string; results: number; answered: boolean; feedback?: "up" | "down" }): void;
}

export interface ModuleCtx {
  /** The project's guides as served to this visitor. */
  library: Guide[];
  /** Close the resource center and open this guide. */
  launch(guideId: string): void;
  /** The visitor used this module ($guide_step). */
  opened(): void;
  assist?: Assist;
}

/** Set once the gateway answered 503: no AI box for the rest of the page. */
let aiOff = false;
export const resetAssist = (): void => void (aiOff = false);

const httpsHref = (u: string): string | null => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.href : null;
  } catch {
    return null;
  }
};

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
    // autocapture never sees the query (this shadow root is data-lc-ignore); `$guide_search` carries only its
    // length unless the project opted in to capturing query text
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
    const ai = el("div");
    ai.setAttribute("aria-live", "polite");
    form.onsubmit = (e) => {
      e.preventDefault();
      ctx.opened();
      const raw = input.value.trim();
      const q = raw.toLowerCase();
      hits.replaceChildren();
      const found = ctx.library.filter((x) => LAUNCHABLE.has(x.kind) && q && (x.name + " " + x.steps.map((st) => `${st.title ?? ""} ${st.body ?? ""}`).join(" ")).toLowerCase().includes(q)).slice(0, 5);
      for (const g of found) hits.append(launchItem(g, ctx));
      ai.replaceChildren();
      if (ctx.assist && !aiOff && raw) void answer(raw, found.length, ctx, ai);
      else ctx.assist?.searched({ query: raw, results: found.length, answered: false });
      const href = searchHref(s, input.value);
      if (href) window.open(href, "_blank", "noopener,noreferrer");
    };
    form.append(ai);
    box.append(form);
  }
  return box;
}

function launchItem(g: Guide, ctx: ModuleCtx): HTMLLIElement {
  const b = el("button", g.name);
  b.type = "button";
  b.onclick = () => ctx.launch(g.id);
  const li = el("li");
  li.append(b);
  return li;
}

/** Ask the gateway, then show the answer, its https citations, suggested guides and Helpful / Not helpful. */
async function answer(query: string, results: number, ctx: ModuleCtx, out: HTMLElement): Promise<void> {
  const assist = ctx.assist!;
  out.textContent = "Finding an answer...";
  const r = await assist.ask(query.slice(0, 500));
  out.replaceChildren();
  if (r === "unavailable") aiOff = true;
  if (!r || r === "unavailable") return assist.searched({ query, results, answered: false });
  const answered = !!r.answer.trim();
  assist.searched({ query, results, answered });
  if (!answered) return;
  out.append(el("h3", "Answer"), el("p", r.answer));
  const cites = el("ul");
  for (const c of (r.citations ?? []).slice(0, 5)) {
    const href = httpsHref(c.url);
    if (!href) continue;
    const a = el("a", c.title || href);
    Object.assign(a, { href, target: "_blank", rel: "noopener noreferrer" });
    const li = el("li");
    li.append(a);
    cites.append(li);
  }
  if (cites.childElementCount) out.append(el("p", "Sources"), cites);
  const sug = el("ul");
  for (const id of (r.guide_ids ?? []).slice(0, 3)) {
    const g = ctx.library.find((x) => x.id === id);
    if (g) sug.append(launchItem(g, ctx));
  }
  if (sug.childElementCount) out.append(el("p", "Suggested guides"), sug);
  const row = el("div");
  const vote = (label: string, feedback: "up" | "down"): HTMLButtonElement => {
    const b = el("button", label);
    b.type = "button";
    b.onclick = () => {
      assist.searched({ query, results, answered, feedback });
      row.replaceChildren(el("p", "Thanks for the feedback."));
    };
    return b;
  };
  row.append(vote("Helpful", "up"), vote("Not helpful", "down"));
  out.append(row);
}

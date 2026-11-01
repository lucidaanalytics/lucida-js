import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flags } from "../src/flags/index.js";
import { guides } from "../src/guides/index.js";
import { toolbar } from "../src/toolbar/index.js";
import { addStep, newDraft, stableSelector, toDoc, validateDraft } from "../src/toolbar/guide-draft.js";
import { resetArbiter } from "../src/arbiter.js";
import type { Client, Guide } from "../src/index.js";
import { startWith } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => {
  resetArbiter();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/app");
});
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
});

describe("guide draft helpers", () => {
  it("prefers data attributes, then ids, then the structural selector", () => {
    document.body.innerHTML = `<div class="card"><button id="buy" data-testid="buy-btn">b</button><a id="x1">a</a><span class="k">s</span></div>`;
    expect(stableSelector(document.getElementById("buy")!)).toBe('[data-testid="buy-btn"]');
    expect(stableSelector(document.getElementById("x1")!)).toBe("#x1");
    expect(stableSelector(document.querySelector(".k")!)).toContain("span.k");
  });
  it("mirrors server validation", () => {
    const d = newDraft();
    expect(validateDraft(d)).toMatch(/Name/);
    d.name = "T";
    expect(validateDraft(d)).toMatch(/at least one step/);
    addStep(d, { title: "hi" });
    expect(validateDraft(d)).toMatch(/picked element/); // tooltip needs a selector
    d.kind = "modal";
    expect(validateDraft(d)).toBeNull();
    addStep(d, { title: "two" });
    expect(validateDraft(d)).toMatch(/exactly one/);
    expect(toDoc({ ...d, kind: "tour" }, "/app").targeting).toEqual({ url: "/app", url_match: "exact" });
  });
});

describe("toolbar guide builder", () => {
  const mount = async (scopes: string[], calls: Array<{ url: string; init?: RequestInit }>) => {
    history.replaceState({}, "", "/app?__lc_toolbar=one");
    const session = { token: "tok", project_id: "p1", scopes, expires_at: "2030-01-01T00:00:00Z" };
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/v1/toolbar/exchange")) return new Response(JSON.stringify(session));
      if (url.endsWith("/guides")) return new Response(JSON.stringify({ id: "g9" }));
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    document.body.innerHTML = `<button id="b" data-testid="cta">Go</button>`;
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    const root = await vi.waitFor(() => [...document.querySelectorAll("[data-lc-ignore]")].find((e) => e.shadowRoot)!.shadowRoot!);
    const by = (l: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === l)!;
    return { root, by };
  };

  it("picks an element, previews, and saves through the guides route with the bearer token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { root, by } = await mount(["actions:write", "guides:write"], calls);
    by("Guide builder").click();
    await vi.waitFor(() => expect(by("Pick element")).toBeTruthy()); // the builder panel is a lazy import
    by("Inspect element").click();
    document.getElementById("b")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    by("Pick element").click();
    const inputs = [...root.querySelectorAll("input")];
    inputs.find((i) => i.placeholder === "Guide name")!.value = "Welcome";
    inputs.find((i) => i.placeholder === "Step title")!.value = "Click here";
    by("Add step").click();
    by("Preview").click();
    const previewed = [...document.querySelectorAll("[data-lc-ignore]")].some((e) => e.shadowRoot && e.shadowRoot !== root && e.shadowRoot.textContent?.includes("Click here"));
    expect(previewed).toBe(true);
    by("Save guide").click();
    const post = await vi.waitFor(() => {
      const c = calls.find((c) => c.url.endsWith("/v1/projects/p1/guides"));
      if (!c) throw new Error("guide not saved yet");
      return c;
    });
    expect((post.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(post.init!.body as string)).toMatchObject({
      name: "Welcome",
      kind: "tooltip",
      steps: [{ id: "s1", title: "Click here", selector: '[data-testid="cta"]' }],
      targeting: { url: "/app" },
    });
  });

  it("disables Save and explains the missing scope", async () => {
    const { root, by } = await mount(["actions:write"], []);
    by("Guide builder").click();
    await vi.waitFor(() => expect(by("Save guide")).toBeTruthy());
    expect((by("Save guide") as HTMLButtonElement).disabled).toBe(true);
    expect(root.textContent).toContain("guides:write");
  });
});

describe("banners and changelog (LC-ENG-8)", () => {
  const banner = (id: string, placement?: "top" | "bottom"): Guide => ({
    id,
    name: id,
    kind: "banner",
    steps: [{ id: "a", title: `News ${id}`, body: "details", ...(placement ? { placement } : {}) }],
    conditions: { url: "/app" },
  });
  const shadow = (): ShadowRoot => document.querySelector<HTMLElement>("[data-lc-ignore]")!.shadowRoot!;
  const dismiss = (): void => [...shadow().querySelectorAll("button")].find((b) => b.textContent === "Dismiss")!.click();

  it("renders a bottom banner with a dismiss button", async () => {
    const { client } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [banner("b1", "bottom")] } } } as never);
    live = client;
    await vi.waitFor(() => expect(document.querySelector("[data-lc-ignore]")).toBeTruthy());
    expect(shadow().querySelector(".bn.bb")).toBeTruthy();
    dismiss();
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
  });

  it("showChangelog lists banner guides, including already-seen ones", async () => {
    const { client, t } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [banner("b1"), banner("b2")] } } } as never);
    live = client;
    await vi.waitFor(() => expect(document.querySelector("[data-lc-ignore]")).toBeTruthy());
    dismiss(); // b1 seen
    expect(client.guides.showChangelog()).toBe(2);
    expect(shadow().textContent).toContain("News b1");
    expect(shadow().textContent).toContain("News b2");
    await client.flush();
    expect(t.events().some((e) => e.event === "$changelog_viewed")).toBe(true);
  });

  it("showChangelog is a no-op without announcements", async () => {
    const { client } = startWith([flags, guides], { _h: { "/v1/guides": { guides: [] } } } as never);
    live = client;
    await client.flush();
    expect(client.guides.showChangelog()).toBe(0);
  });
});

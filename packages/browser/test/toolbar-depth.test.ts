import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stepElements, stepFromElement, stepOnPage } from "../src/toolbar/actions-ui.js";
import { categoryOf, matcher } from "../src/toolbar/debugger.js";
import { overrideChoices } from "../src/toolbar/flags-ui.js";
import { STABLE_ATTRS } from "../src/toolbar/guide-draft.js";
import { pagePath, rowElements } from "../src/toolbar/heat.js";
import { toolbar } from "../src/toolbar/index.js";
import type { Client } from "../src/index.js";
import { startWith } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => {
  history.replaceState({}, "", "/p");
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

const session = (scopes: string[]) => ({ token: "tok", project_id: "p1", scopes, origin: "http://localhost", expires_at: "2030-01-01T00:00:00Z" });

function server(scopes: string[], extra: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.endsWith("/v1/toolbar/exchange")) return new Response(JSON.stringify(session(scopes)));
    return extra(url, init) ?? new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const shadow = () =>
  vi.waitFor(() => [...document.querySelectorAll("[data-lc-ignore]")].find((e) => e.shadowRoot)!.shadowRoot!);
const button = (root: ShadowRoot, label: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("toolbar actions", () => {
  it("builds a step from a picked element with the preferred data attribute, link and page", () => {
    document.body.innerHTML = `<a href="/pricing"><span data-qa="go" data-testid="t">See pricing</span></a>`;
    const span = document.querySelector("span")!;
    expect(stepFromElement(span, STABLE_ATTRS, "/home")).toEqual({
      selector: '[data-testid="t"]',
      text: "See pricing",
      text_match: "exact",
      href: "/pricing",
      href_match: "exact",
      url: "/home",
      url_match: "contains",
    });
    expect(stepFromElement(span, ["data-qa"]).selector).toBe('[data-qa="go"]');
  });

  it("finds the elements a step matches on this page only", () => {
    document.body.innerHTML = `<button class="buy">Buy</button><button class="buy">Later</button><a href="/x">x</a>`;
    expect(stepElements({ selector: "button.buy" })).toHaveLength(2);
    expect(stepElements({ selector: "button.buy", text: "Buy" })).toHaveLength(1);
    expect(stepElements({ selector: "button.buy", text: "u", text_match: "contains" })).toHaveLength(1);
    expect(stepElements({ href: "/x" })).toHaveLength(1);
    expect(stepElements({ selector: "button.buy", url: "/other", url_match: "exact" })).toHaveLength(0);
    expect(stepOnPage({ url: "^http.*/p$", url_match: "regex" })).toBe(true);
    expect(stepElements({ selector: "[[bad" })).toEqual([]);
  });

  it("saves an action with two OR elements and edited fields", async () => {
    history.replaceState({}, "", "/p?__lc_toolbar=one");
    const { calls, fetchImpl } = server(["actions:write"], (url) => (url.endsWith("/actions") ? new Response(JSON.stringify({ id: "a1", name: "CTA", steps: [] })) : undefined));
    document.body.innerHTML = `<button id="a">One</button><button id="b">Two</button>`;
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    const root = await shadow();
    button(root, "Actions").click();
    for (const id of ["a", "b"]) {
      button(root, "Inspect element").click();
      document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      button(root, "Add picked element").click();
    }
    expect([...root.querySelectorAll("legend")].map((l) => l.textContent)).toEqual(["Element 1", "OR element 2"]);
    const text = [...root.querySelectorAll("label")].filter((l) => l.textContent?.startsWith("Text ") && !l.textContent.startsWith("Text match"))[1]!.querySelector("input")!;
    text.value = "Tw";
    text.dispatchEvent(new Event("input"));
    const how = [...root.querySelectorAll("label")].filter((l) => l.textContent?.startsWith("Text match"))[1]!.querySelector("select")!;
    how.value = "contains";
    how.dispatchEvent(new Event("change"));
    root.querySelector<HTMLInputElement>("input[placeholder='Action name']")!.value = "CTA";
    button(root, "Save action").click();
    const post = await vi.waitFor(() => calls.find((c) => c.init?.method === "POST" && c.url.endsWith("/actions"))!);
    const body = JSON.parse(post.init!.body as string);
    expect(body.steps).toHaveLength(2);
    expect(body.steps[1]).toMatchObject({ selector: "#b", text: "Tw", text_match: "contains" });
  });

  it("overlays existing actions with numbered boxes, then deletes one", async () => {
    history.replaceState({}, "", "/p?__lc_toolbar=one");
    let deleted = false;
    const { calls, fetchImpl } = server(["actions:write"], (url, init) => {
      if (init?.method === "DELETE") return (deleted = true), new Response(null, { status: 204 });
      if (url.includes("/actions?")) return new Response(JSON.stringify({ data: deleted ? [] : [{ id: "a1", name: "Buy", steps: [{ selector: "button.buy" }] }] }));
      return undefined;
    });
    document.body.innerHTML = `<button class="buy">A</button><button class="buy">B</button>`;
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    const root = await shadow();
    button(root, "Actions").click();
    button(root, "Show existing actions").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Buy (2 on this page)"));
    expect(root.textContent).toContain("2 matched elements on this page");
    const labels = [...document.body.querySelectorAll("[data-lc-ignore] > span")].map((s) => s.textContent);
    expect(labels).toEqual(["1 Buy", "2 Buy"]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    button(root, "Delete").click();
    await vi.waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE" && c.url.endsWith("/actions/a1"))).toBe(true));
    await vi.waitFor(() => expect(root.textContent).toContain("0 matched elements"));
  });

  it("a view-only session gets no actions panel", async () => {
    history.replaceState({}, "", "/p?__lc_toolbar=one");
    const { fetchImpl } = server(["heatmaps:read", "flags:read"]);
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    const root = await shadow();
    expect(root.textContent).toContain("(view only)");
    expect(button(root, "Actions")).toBeUndefined();
  });
});

describe("toolbar launch", () => {
  it("reads the token from the hash, strips it and exchanges on uiHost", async () => {
    history.replaceState({}, "", "/p#__lc_toolbar=hashtok&tab=2");
    const { calls, fetchImpl } = server(["heatmaps:read"]);
    const { client } = startWith([toolbar], { fetch: fetchImpl, uiHost: "https://app.lucida.test/" });
    live = client;
    await shadow();
    expect(calls[0]!.url).toBe("https://app.lucida.test/v1/toolbar/exchange");
    expect(JSON.parse(calls[0]!.init!.body as string).token).toBe("hashtok");
    expect(location.hash).toBe("#tab=2");
  });

  it("loadToolbar starts it from a token the page carried itself", async () => {
    const { calls, fetchImpl } = server(["heatmaps:read"]);
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    expect(calls).toHaveLength(0);
    expect(await client.loadToolbar({ token: "manual" })).toBe(true);
    expect(JSON.parse(calls[0]!.init!.body as string).token).toBe("manual");
    await shadow();
    const bare = startWith([], {});
    expect(await bare.client.loadToolbar("x")).toBe(false);
    await bare.client.shutdown();
  });
});

describe("toolbar heatmap, flags and debugger", () => {
  it("normalises the page path and finds link rows by href", () => {
    expect(pagePath("/shop/")).toBe("/shop");
    expect(pagePath("/")).toBe("/");
    document.body.innerHTML = `<a href="/p/1">a</a><a href="/p/1">b</a><a href="/p/2">c</a>`;
    const row = { selector: "/p/1", clicks: 2, rage_clicks: 0, dead_clicks: 0, click_share: 1 };
    expect(rowElements(row, true)).toHaveLength(2);
    expect(rowElements({ ...row, selector: "a" }, false)).toHaveLength(3);
    expect(rowElements({ ...row, selector: "::nope(" }, false)).toEqual([]);
  });

  it("switches heatmap type and pages elements with Load all", async () => {
    history.replaceState({}, "", "/p?__lc_toolbar=one");
    const { calls, fetchImpl } = server(["heatmaps:read"], (url) => {
      if (url.includes("type=scroll")) return new Response(JSON.stringify({ sessions: 4, reach: [{ depth_pct: 10, sessions: 4 }, { depth_pct: 20, sessions: 2 }] }));
      if (url.includes("/heatmaps/elements"))
        return new Response(JSON.stringify({ key: "selector", next_cursor: url.includes("cursor=") ? null : "c1", data: [{ selector: url.includes("cursor=") ? "#y" : "#x", clicks: 1, rage_clicks: 0, dead_clicks: 0, click_share: 0.5 }] }));
      if (url.includes("/heatmaps?")) return new Response(JSON.stringify({ bins: [], total: 0, max: 0, x_bins: 50, y_bin_px: 20 }));
      return undefined;
    });
    document.body.innerHTML = `<b id="x">x</b><b id="y">y</b>`;
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    const root = await shadow();
    button(root, "Heatmap").click();
    button(root, "Show heatmap").click();
    await vi.waitFor(() => expect(button(root, "Load all").parentElement!.style.display).toBe(""));
    button(root, "Load all").click();
    await vi.waitFor(() => expect(root.textContent).toContain("2: 1 clicks #y"));
    expect(calls.some((c) => c.url.includes("cursor=c1"))).toBe(true);
    const type = root.querySelector<HTMLSelectElement>("select")!;
    type.value = "scroll";
    button(root, "Show heatmap").click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("50% reached"));
  });

  it("offers on/off and every variant as override values", () => {
    expect(overrideChoices({ key: "k", variants: [{ key: "a" }, { key: "b" }] }, "a").map((c) => c[0])).toEqual(["__default", "true", "false", "v:a", "v:b"]);
    expect(overrideChoices(undefined, "solo").map((c) => c[1])).toContain("solo");
  });

  it("flag panel searches and stores a variant override with a reload prompt", async () => {
    history.replaceState({}, "", "/p?__lc_toolbar=one");
    const { fetchImpl } = server(["flags:read"], (url) =>
      url.includes("/flags?limit") ? new Response(JSON.stringify({ data: [{ key: "checkout", variants: [{ key: "control" }, { key: "test" }] }, { key: "beta" }] })) : undefined,
    );
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    const root = await shadow();
    button(root, "Feature flags").click();
    await vi.waitFor(() => expect(root.textContent).toContain("checkout"));
    const search = root.querySelector<HTMLInputElement>("input[placeholder='Search flags']")!;
    search.value = "check";
    search.dispatchEvent(new Event("input"));
    expect(root.textContent).not.toContain("beta =");
    const pick = [...root.querySelectorAll("label")].find((l) => l.textContent?.startsWith("checkout"))!.querySelector("select")!;
    pick.value = "v:test";
    pick.dispatchEvent(new Event("change"));
    expect(JSON.parse(localStorage.getItem("lc_flag_overrides")!)).toEqual({ checkout: "test" });
    expect(button(root, "Reload now")).toBeTruthy();
  });

  it("debugger filters by text, regex and category, and holds events while paused", async () => {
    expect(matcher("/^\\$page/")("$pageview")).toBe(true);
    expect(matcher("/[/")("x")).toBe(false);
    expect(matcher("SIGN")("signup")).toBe(true);
    expect([categoryOf("signup"), categoryOf("$pageview"), categoryOf("$rageclick")]).toEqual(["custom", "system", "replay"]);
    history.replaceState({}, "", "/p?__lc_toolbar=one");
    const { fetchImpl } = server(["heatmaps:read"]);
    const { client } = startWith([toolbar], { fetch: fetchImpl });
    live = client;
    const root = await shadow();
    button(root, "Event debugger").click();
    client.capture("signup", { plan: "pro" });
    client.capture("$pageview");
    expect(root.textContent).toContain("2 of 2 events");
    const q = root.querySelector<HTMLInputElement>("input[placeholder='name, payload or /regex/']")!;
    q.value = "pro";
    q.dispatchEvent(new Event("input"));
    expect(root.textContent).toContain("1 of 2 events");
    const pause = [...root.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Pause"))!.querySelector("input")!;
    pause.checked = true;
    pause.dispatchEvent(new Event("change"));
    client.capture("later");
    expect(root.textContent).toContain("1 held while paused");
    pause.checked = false;
    pause.dispatchEvent(new Event("change"));
    expect(root.textContent).toContain("of 3 events");
  });
});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { opened } from "./support/react-native.js";
import { LucidaGuides, LucidaProvider, createClient, matchGuideScreen } from "../src/index.js";
type Client = Awaited<ReturnType<typeof createClient>>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const guidesJSON = {
  guides: [
    { id: "g-tour", name: "Tour", kind: "tour", conditions: { url: "Home", person_filters: [] }, steps: [{ id: "s1", title: "Hi" }, { id: "s2", body: "Last", buttons: [{ label: "Docs", action: "link", url: "https://docs.test/x" }] }] },
    { id: "g-person", name: "P", kind: "modal", conditions: { person_filters: [{ key: "plan", op: "eq", value: "pro" }] }, steps: [{ id: "a" }] },
    { id: "g-hotspot", name: "H", kind: "hotspot", conditions: {}, steps: [{ id: "a", selector: "#x" }] },
    { id: "g-flag", name: "F", kind: "banner", conditions: { flag_key: "beta", url: "Set", url_match: "regex" }, steps: [{ id: "b" }] },
  ],
};

async function setup(flags: Record<string, boolean> = {}, body: unknown = guidesJSON) {
  const sent: Array<{ event: string; properties?: Record<string, unknown> }> = [];
  const urls: string[] = [];
  const client = await createClient("lc_pk_test", {
    apiHost: "https://ingest.test",
    guides: { enabled: true },
    flushAt: 1000,
    transport: { send: async (_u: string, b: string) => (sent.push(...JSON.parse(b).batch), { status: 200 }) },
    fetch: (async (u: string) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => (u.includes("/v1/guides") ? body : { flags: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, { enabled: v, value: v }])) }) };
    }) as unknown as typeof fetch,
  });
  const names = async () => (await client.flush(), sent.map((e) => e.event).filter((n) => n.startsWith("$guide")));
  return { client, urls, names, sent };
}

const tick = () => new Promise((r) => setTimeout(r, 20));
const mount = async (client: Client) => {
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(async () => root.render(<LucidaProvider client={client}><LucidaGuides /></LucidaProvider>));
  return { el, root };
};
const press = async (el: HTMLElement, label: string) => act(async () => el.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click());

describe("react-native guides (LC-ENG-15)", () => {
  it("shows the tour on its screen with events, https link and show-once", async () => {
    const { client, urls, names } = await setup();
    const { el, root } = await mount(client);
    client.guides.show("Settings"); // nothing loaded yet
    await client.guides.reload();
    expect(urls.some((u) => u.includes("/v1/guides?api_key=lc_pk_test&distinct_id="))).toBe(true);
    expect(client.guides.current()).toBeNull();

    await act(async () => client.guides.show("HomeScreen"));
    expect(el.textContent).toContain("Hi");
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Next", "Dismiss"]);
    await press(el, "Next");
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Docs"]);
    await press(el, "Docs");
    expect(opened).toEqual(["https://docs.test/x"]);
    expect(el.querySelector("#modal")).toBeNull();
    expect(await names()).toEqual(["$guide_shown", "$guide_step", "$guide_step", "$guide_completed"]);

    await act(async () => client.guides.show("HomeScreen"));
    expect(client.guides.current()).toBeNull(); // shown once; person-targeted and hotspot never show
    await act(async () => root.unmount());
  });

  it("flag + regex targeting and dismissal by closing", async () => {
    const { client, names } = await setup({ beta: true });
    const { root } = await mount(client);
    await client.guides.reload();
    await act(async () => client.guides.show("Settings"));
    expect(client.guides.current()?.guide.id).toBe("g-flag");
    expect(client.guides.current()?.buttons.map((b) => b.label)).toEqual(["Dismiss"]);
    await act(async () => client.guides.act(null));
    expect(await names()).toContain("$guide_dismissed");
    await act(async () => root.unmount());
  });

  it("flag off, not-set conditions, previews, non-https links, no mounted view", async () => {
    const body = {
      guides: [
        { id: "off", name: "x", kind: "modal", conditions: { flag_key: "beta" }, steps: [{ id: "a" }] },
        { id: "blank", name: "x", kind: "modal", conditions: { flag_key: "", devices: [], url: null, seen_guides: [] }, steps: [{ id: "a", buttons: [{ label: "Go", action: "link", url: "http://x.test" }] }] },
        { id: "pv", name: "x", kind: "modal", preview: true, conditions: { flag_key: "beta", person_filters: [1] }, steps: [{ id: "a" }, { id: "b" }] },
      ],
    };
    const { client, names } = await setup({}, body);
    await client.guides.reload();
    client.guides.show("A"); // nobody subscribed: nothing consumed
    expect(client.guides.current()).toBeNull();
    const { root } = await mount(client); // mounting picks the pending guide up
    expect(client.guides.current()?.guide.id).toBe("blank");
    await act(async () => client.guides.act({ label: "Go", action: "link", url: "http://x.test" }));
    expect(opened).not.toContain("http://x.test");
    expect(client.guides.current()?.guide.id).toBe("pv"); // next eligible; preview quiet
    await act(async () => client.guides.act({ label: "Next", action: "next" }));
    await act(async () => client.guides.act({ label: "Done", action: "next" }));
    expect(client.guides.current()).toBeNull();
    await act(async () => client.guides.show("A"));
    expect(client.guides.current()).toBeNull(); // preview once per launch
    expect(await names()).toEqual(["$guide_shown", "$guide_step", "$guide_completed"]);
    await act(async () => root.unmount());
    await tick();
  });

  it("match modes", () => {
    expect(matchGuideScreen("Checkout", "Check", "contains")).toBe(true);
    expect(matchGuideScreen("Checkout", "Check", "exact")).toBe(false);
    expect(matchGuideScreen("Checkout", "^Check.*t$", "regex")).toBe(true);
    expect(matchGuideScreen("Checkout", "(", "regex")).toBe(false);
  });

  it("is off by default: no request", async () => {
    const urls: string[] = [];
    const c = await createClient("k", { fetch: (async (u: string) => (urls.push(u), { ok: true, json: async () => ({}) })) as never, transport: { send: async () => ({ status: 200 }) } });
    await tick();
    expect(urls.some((u) => u.includes("/v1/guides"))).toBe(false);
    await c.shutdown();
  });
});

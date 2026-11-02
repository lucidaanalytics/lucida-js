import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { LucidaGuides, LucidaProvider, bubbleOrigin, screenExcluded, createClient, guideAnchor, guideTokens, measureAnchor, registerAnchor } from "../src/index.js";
import type { MobileGuide } from "../src/index.js";
type Client = Awaited<ReturnType<typeof createClient>>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// N-DAP-10 / N-DAP-7 / N-DAP-9: anchored steps by testID (<GuideAnchor>), carousel paging, theme tokens.
async function setup(guides: unknown[]) {
  const sent: Array<{ event: string; properties?: Record<string, unknown> }> = [];
  const client = await createClient("lc_pk_test", {
    apiHost: "https://ingest.test",
    guides: { enabled: true },
    flushAt: 1000,
    transport: { send: async (_u: string, b: string) => (sent.push(...JSON.parse(b).batch), { status: 200 }) },
    fetch: (async (u: string) => ({ ok: true, status: 200, json: async () => (u.includes("/v1/guides") ? { guides } : { flags: {} }) })) as unknown as typeof fetch,
  });
  return { client, sent };
}
const mount = async (client: Client) => {
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(async () => root.render(<LucidaProvider client={client}><LucidaGuides /></LucidaProvider>));
  return { el, root };
};
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const labels = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => b.textContent);

describe("anchored guides on react-native", () => {
  it("anchors a tooltip at a registered view and follows it", async () => {
    let y = 100;
    const off = registerAnchor("checkout", { measureInWindow: (cb) => cb(50, y, 100, 40) });
    expect(await measureAnchor("checkout")).toEqual({ x: 50, y: 100, width: 100, height: 40 });
    expect(await measureAnchor("nope")).toBeNull();
    const { client, sent } = await setup([{ id: "tt", name: "T", kind: "tooltip", conditions: {}, steps: [{ id: "a", title: "Pay here", native_id: "checkout" }] }]);
    const { el, root } = await mount(client);
    await client.guides.reload();
    await act(async () => client.guides.show("Home"));
    expect(client.guides.current()?.anchor).toEqual({ nativeId: "checkout", waitMs: 3000, hotspot: false });
    await wait(50);
    expect(el.textContent).toContain("Pay here");
    expect(el.querySelector("#modal")).toBeNull(); // drawn over the app, not as a modal
    y = 300;
    await wait(150);
    await act(async () => el.querySelector<HTMLElement>('button[aria-label="Done"]')!.click());
    expect(client.guides.current()).toBeNull();
    await client.flush();
    expect(sent.map((e) => e.event)).toContain("$guide_completed");
    off();
    await act(async () => root.unmount());
  });

  it("reports a missing anchor and shows the step as a modal", async () => {
    const { client, sent } = await setup([{ id: "tt", name: "T", kind: "tour", conditions: {}, steps: [{ id: "a", title: "Where", native_id: "gone", wait_ms: 0 }] }]);
    const { el, root } = await mount(client);
    await client.guides.reload();
    await act(async () => client.guides.show("Home"));
    await wait(50);
    expect(el.querySelector("#modal")?.textContent).toContain("Where");
    await client.flush();
    const ev = sent.find((e) => e.event === "$guide_target_missing");
    expect(ev?.properties).toMatchObject({ $guide_id: "tt", step_id: "a", selector: "gone" });
    await act(async () => root.unmount());
  });

  it("tooltip and hotspot guides need a native_id", async () => {
    const { client } = await setup([
      { id: "h0", name: "H", kind: "hotspot", conditions: {}, steps: [{ id: "a", selector: "#web" }] },
      { id: "h1", name: "H", kind: "hotspot", conditions: {}, steps: [{ id: "a", native_id: "bell" }] },
    ]);
    const { root } = await mount(client);
    await client.guides.reload();
    await act(async () => client.guides.show("Home"));
    expect(client.guides.current()?.guide.id).toBe("h1");
    expect(client.guides.current()?.anchor?.hotspot).toBe(true);
    await act(async () => root.unmount());
  });

  it("carousel pages with Back and Next and shows a pager", async () => {
    const { client } = await setup([{ id: "c", name: "C", kind: "carousel", conditions: {}, steps: [{ id: "1", title: "One" }, { id: "2", title: "Two" }] }]);
    const { el, root } = await mount(client);
    await client.guides.reload();
    await act(async () => client.guides.show("Home"));
    expect(labels(el)).toEqual(["Next", "Dismiss"]);
    await act(async () => el.querySelector<HTMLElement>('button[aria-label="Next"]')!.click());
    expect(labels(el)).toEqual(["Back", "Done", "Dismiss"]);
    await act(async () => el.querySelector<HTMLElement>('button[aria-label="Back"]')!.click());
    expect(el.textContent).toContain("One");
    await act(async () => root.unmount());
  });

  it("queued guides go first and skip sampling; exclusions match screen names", async () => {
    const { client } = await setup([
      { id: "plain", name: "P", kind: "modal", conditions: {}, steps: [{ id: "a" }] },
      { id: "q", name: "Q", kind: "modal", queued: true, conditions: { sample_pct: 0 }, steps: [{ id: "a" }] },
      { id: "x", name: "X", kind: "modal", conditions: { exclude_url_patterns: ["Check*"] }, steps: [{ id: "a" }] },
    ]);
    const { root } = await mount(client);
    await client.guides.reload();
    const seen: string[] = [];
    await act(async () => client.guides.show("Checkout"));
    while (client.guides.current()) {
      seen.push(client.guides.current()!.guide.id);
      await act(async () => client.guides.act(null));
    }
    expect(seen).toEqual(["q", "plain"]); // x is excluded on Checkout
    await act(async () => client.guides.show("Home"));
    expect(client.guides.current()?.guide.id).toBe("x");
    expect(screenExcluded("a.b", ["a?b"])).toBe(false);
    expect(screenExcluded("Checkout", ["", "*out"])).toBe(true);
    await act(async () => root.unmount());
  });

  it("theme tokens, anchor spec and placement", () => {
    const a = { tokens: { background: "#ffffff", accent: "javascript:x", radius: 8 }, dark: { tokens: { background: "#000" } }, font_family: "Inter" };
    expect(guideTokens(a, false)).toEqual({ font: "Inter", background: "#ffffff", radius: 8 });
    expect(guideTokens(a, true).background).toBe("#000");
    expect(guideTokens({ ...a, theme_mode: "light" }, true).background).toBe("#ffffff");
    const g: MobileGuide = { id: "t", name: "T", kind: "tour", conditions: {}, steps: [{ id: "a", native_id: "x", wait_ms: 99_999, placement: "top" }, { id: "b" }] };
    expect(guideAnchor(g, 0)).toEqual({ nativeId: "x", placement: "top", waitMs: 15_000, hotspot: false });
    expect(guideAnchor(g, 1)).toBeUndefined();
    const bounds = { x: 0, y: 0, width: 400, height: 800 };
    expect(bubbleOrigin(200, 100, { x: 100, y: 100, width: 50, height: 40 }, bounds)).toEqual({ x: 25, y: 148 });
    expect(bubbleOrigin(200, 100, { x: 100, y: 740, width: 50, height: 40 }, bounds).y).toBe(632);
  });
});

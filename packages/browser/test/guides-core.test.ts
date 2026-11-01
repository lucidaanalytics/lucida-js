import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flags } from "../src/flags/index.js";
import { guides } from "../src/guides/index.js";
import { bucket, heldOut, variantOf } from "../src/guides/ab.js";
import { localize } from "../src/guides/locale.js";
import { resetArbiter } from "../src/arbiter.js";
import { eligible, frequencyOk, scheduleOk } from "../src/targeting.js";
import type { Client, Guide } from "../src/index.js";
import type { TargetConditions } from "../src/types.js";
import { startWith, tick } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => {
  resetArbiter();
  localStorage.clear();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/app");
});
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
});

const guide = (over: Partial<Guide> = {}): Guide => ({
  id: "g1",
  name: "Welcome",
  kind: "modal",
  steps: [{ id: "a", title: "Hello", body: "Body" }],
  conditions: {},
  ...over,
});
const boot = (list: Guide[], cfg: Record<string, unknown> = {}) => {
  const r = startWith([flags, guides], { persistence: "localStorage", _h: { "/v1/guides": { guides: list } }, ...cfg } as never);
  live = r.client;
  return r;
};
const shadow = (): ShadowRoot => document.querySelector<HTMLElement>("[data-lc-ignore]")!.shadowRoot!;
const click = (label: string): void => [...shadow().querySelectorAll("button")].find((b) => b.textContent === label)!.click();
/** A stored guide key (keys carry a per-project suffix). */
const stored = (k: string): string => Object.keys(localStorage).filter((x) => x.startsWith(k)).map((x) => localStorage.getItem(x)).join("");
const names = (t: ReturnType<typeof boot>["t"]) => t.events().filter((e) => e.event.startsWith("$guide_")).map((e) => e.event);

describe("targeting: audience, schedule, frequency", () => {
  const ctx = { url: "https://x.test/app", flags: () => true, lastShownMs: undefined, nowMs: Date.parse("2026-03-04T10:30:00"), random: () => 0 };
  const ok = (c: TargetConditions, extra = {}) => eligible({ conditions: c }, { ...ctx, ...extra });

  it("person, group and seen-guide filters", () => {
    expect(ok({ person_filters: [{ key: "plan", op: "eq", value: "pro" }] }, { person: { plan: "pro" } })).toBe(true);
    expect(ok({ person_filters: [{ key: "plan", op: "eq", value: "pro" }] }, { person: { plan: "free" } })).toBe(false);
    expect(ok({ group_filters: [{ group_type: "org", key: "seats", op: "exists" }] }, { groups: { org: { seats: 5 } } })).toBe(true);
    expect(ok({ group_filters: [{ group_type: "org", key: "seats", op: "exists" }] }, { groups: {} })).toBe(false);
    expect(ok({ group_filters: [{ group_type: "org", key: "tier", op: "neq", value: "free" }] }, { groups: {} })).toBe(true);
    expect(ok({ seen_guides: ["other"] }, { seen: (id: string) => id === "other" })).toBe(true);
    expect(ok({ seen_guides: ["other"] }, { seen: () => false })).toBe(false);
    expect(ok({ not_seen_guides: ["other"] }, { seen: (id: string) => id === "other" })).toBe(false);
    expect(ok({ devices: ["mobile"] }, { device: "desktop" })).toBe(false);
  });

  it("schedule window, weekdays and local hours", () => {
    const at = (s: string) => Date.parse(s); // 2026-03-04 is a Wednesday (3)
    expect(scheduleOk({ start: "2026-03-05T00:00:00Z" }, at("2026-03-04T10:00:00Z"))).toBe(false);
    expect(scheduleOk({ end: "2026-03-05T00:00:00Z" }, at("2026-03-04T10:00:00Z"))).toBe(true);
    expect(scheduleOk({ end: "2026-03-04T00:00:00Z" }, at("2026-03-04T10:00:00Z"))).toBe(false);
    expect(scheduleOk({ days: [3] }, at("2026-03-04T10:30:00"))).toBe(true);
    expect(scheduleOk({ days: [1, 2] }, at("2026-03-04T10:30:00"))).toBe(false);
    expect(scheduleOk({ hours: { from: 9, to: 11 } }, at("2026-03-04T10:30:00"))).toBe(true);
    expect(scheduleOk({ hours: { from: 11, to: 17 } }, at("2026-03-04T10:30:00"))).toBe(false);
  });

  it("frequency cap over a rolling window", () => {
    const day = 86_400_000;
    const now = 500 * day;
    expect(frequencyOk({ max_views: 2, per_days: 7 }, [now - 8 * day, now - day], now)).toBe(true);
    expect(frequencyOk({ max_views: 2, per_days: 7 }, [now - 2 * day, now - day], now)).toBe(false);
    expect(frequencyOk({ max_views: 1 }, [now - 200 * day], now)).toBe(false); // lifetime
  });
});

describe("localisation", () => {
  const g = guide({
    steps: [{ id: "a", title: "Hello", body: "Body", i18n: { fr: { title: "Bonjour", buttons: ["Suivant", "Fermer"] }, "pt-br": { title: "Olá" } } }],
    appearance: { i18n: { fr: { name: "Accueil" } } },
  });
  it("matches exact locale, then language, then falls back", () => {
    expect(localize(g, ["fr-CA"]).steps[0]!.title).toBe("Bonjour");
    expect(localize(g, ["pt_BR"]).steps[0]!.title).toBe("Olá");
    expect(localize(g, ["de", "fr"]).steps[0]!.title).toBe("Bonjour"); // first candidate with text wins
    expect(localize(g, ["de"])).toBe(g);
    expect(localize(g, ["fr"]).name).toBe("Accueil");
    expect(localize(g, ["fr"]).steps[0]!.buttons!.map((b) => b.label)).toEqual(["Done", "Fermer"].map((l, i) => (i ? l : "Suivant")));
  });
  it("renders in the person property locale", async () => {
    boot([g], { localFlagsContext: { person_properties: { locale: "fr" } } });
    await vi.waitFor(() => expect(shadow().textContent).toContain("Bonjour"));
  });
});

describe("A/B variants and holdout", () => {
  const a = guide({ id: "a", conditions: { ab_group: "x" } });
  const b = guide({ id: "b", conditions: { ab_group: "x", ab_weight: 3 } });
  it("assigns stably and by weight", () => {
    expect(variantOf(a, [a, b], "u1")).toBe(variantOf(b, [b, a], "u1"));
    const picks = Array.from({ length: 2000 }, (_, i) => variantOf(a, [a, b], `u${i}`).id);
    const share = picks.filter((x) => x === "b").length / picks.length;
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.8);
    expect(bucket("u1", "s")).toBe(bucket("u1", "s"));
  });
  it("holds out about holdout_pct of people", () => {
    const h = guide({ conditions: { holdout_pct: 20 } });
    const held = Array.from({ length: 2000 }, (_, i) => heldOut(h, `u${i}`)).filter(Boolean).length / 2000;
    expect(held).toBeGreaterThan(0.16);
    expect(held).toBeLessThan(0.24);
  });
  it("a held-out person gets $guide_holdout once and no guide; others see it", async () => {
    const g = guide({ conditions: { holdout_pct: 50 } });
    const ids = Array.from({ length: 40 }, (_, i) => `u${i}`);
    const [inHold, outHold] = [ids.find((k) => heldOut(g, k))!, ids.find((k) => !heldOut(g, k))!];
    const held = boot([g], { bootstrap: { distinctId: inHold } });
    await vi.waitFor(() => expect(held.f.calls.some((c) => c.url.includes("/v1/guides"))).toBe(true));
    await tick(20);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
    await held.client.flush();
    const ev = held.t.events().filter((e) => e.event === "$guide_holdout");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.properties).toMatchObject({ $guide_id: "g1" });
    await live!.shutdown();
    localStorage.clear();
    boot([g], { bootstrap: { distinctId: outHold } });
    await vi.waitFor(() => expect(shadow().textContent).toContain("Hello"));
  });
});

describe("step branching and cross-page tours", () => {
  const tour = (): Guide =>
    guide({
      id: "t",
      kind: "tour",
      steps: [
        { id: "a", title: "Role?", selector: "#x", buttons: [{ label: "Dev", action: "next", goto: "c" }, { label: "Other", action: "next" }] },
        { id: "b", title: "Generic", selector: "#x" },
        { id: "c", title: "Developer tips", selector: "#x" },
      ],
    });

  it("a button goto skips ahead and later steps are not reported", async () => {
    document.body.innerHTML = `<button id="x">x</button>`;
    const { client, t } = boot([tour()]);
    await vi.waitFor(() => expect(shadow().textContent).toContain("Role?"));
    click("Dev");
    expect(shadow().textContent).toContain("Developer tips");
    await client.flush();
    expect(t.events().filter((e) => e.event === "$guide_step").map((e) => e.properties.$guide_step_id)).toEqual(["a", "c"]);
  });

  it("branch rules read person properties", async () => {
    document.body.innerHTML = `<button id="x">x</button>`;
    const g = tour();
    delete g.steps[0]!.buttons;
    g.steps[0]!.branch = [{ key: "role", op: "eq", value: "dev", goto: "c" }];
    boot([g], { localFlagsContext: { person_properties: { role: "dev" } } });
    await vi.waitFor(() => expect(shadow().textContent).toContain("Role?"));
    click("Next");
    expect(shadow().textContent).toContain("Developer tips");
  });

  it("a step on another page pauses the tour and the next page resumes it", async () => {
    document.body.innerHTML = `<button id="x">x</button>`;
    const g = guide({ id: "t", kind: "tour", steps: [{ id: "a", title: "One", selector: "#x" }, { id: "b", title: "Two", selector: "#x", url: "/billing" }] });
    const first = boot([g]);
    await vi.waitFor(() => expect(shadow().textContent).toContain("One"));
    click("Next");
    expect(document.querySelector("[data-lc-ignore]")).toBeNull(); // waiting for /billing
    await first.client.flush();
    expect(names(first.t)).toEqual(["$guide_shown", "$guide_step"]);
    await live!.shutdown();
    resetArbiter();
    history.replaceState({}, "", "/home");
    boot([g]);
    await tick(30);
    expect(document.querySelector("[data-lc-ignore]")).toBeNull(); // wrong page: still waiting
    await live!.shutdown();
    history.replaceState({}, "", "/billing");
    const again = boot([g]);
    await vi.waitFor(() => expect(shadow().textContent).toContain("Two"));
    click("Done");
    await again.client.flush();
    expect(names(again.t)).toEqual(["$guide_step", "$guide_completed"]); // no second $guide_shown
    expect(stored("lc_guide_progress")).not.toContain('"t"');
  });
});

describe("frequency and seen-guide targeting end to end", () => {
  it("a frequency cap re-shows the guide until the cap, a plain guide shows once", async () => {
    const g = guide({ conditions: { frequency: { max_views: 2, per_days: 1 } } });
    for (let i = 0; i < 3; i++) {
      resetArbiter();
      document.body.innerHTML = "";
      boot([g]);
      await tick(30);
      const shown = !!document.querySelector("[data-lc-ignore]");
      expect(shown).toBe(i < 2);
      if (shown) click("Dismiss");
      await live!.shutdown();
    }
  });
});

describe("checklist auto-completion", () => {
  const list = (): Guide =>
    guide({
      id: "c",
      kind: "checklist",
      steps: [
        { id: "inv", title: "Invite", complete_on: { event: "invited", props: { role: "admin" } } },
        { id: "plan", title: "Pick plan", complete_on: { event: "plan_picked" } },
      ],
    });

  it("ticks items from product events, survives a reload and completes", async () => {
    const first = boot([list()]);
    await vi.waitFor(() => expect(shadow().textContent).toContain("Invite"));
    first.client.capture("invited", { role: "member" }); // props differ: no tick
    expect(shadow().textContent).not.toContain("✓ Invite");
    first.client.capture("invited", { role: "admin" });
    expect(shadow().textContent).toContain("✓ Invite");
    await first.client.flush();
    expect(first.t.events().filter((e) => e.event === "$guide_step").map((e) => e.properties.$guide_step_id)).toEqual(["inv"]);
    await live!.shutdown();
    resetArbiter();
    const again = boot([list()]);
    await vi.waitFor(() => expect(shadow().textContent).toContain("✓ Invite"));
    again.client.capture("plan_picked");
    await again.client.flush();
    expect(document.querySelector("[data-lc-ignore]")).toBeNull();
    expect(names(again.t)).toEqual(["$guide_step", "$guide_completed"]);
  });

  it("an item completes even while the list is not on screen", async () => {
    const g = list();
    const first = boot([g]);
    await vi.waitFor(() => expect(shadow().textContent).toContain("Invite"));
    await live!.shutdown(); // list closed by teardown but still in progress in storage
    resetArbiter();
    document.body.innerHTML = "";
    const { client, t, f } = boot([g], { guides: { render: false } });
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.includes("/v1/guides"))).toBe(true));
    await tick(10);
    client.capture("invited", { role: "admin" });
    await client.flush();
    expect(t.events().filter((e) => e.event === "$guide_step").map((e) => [e.properties.$guide_step_id, e.properties.$guide_auto])).toEqual([["inv", true]]);
    expect(first.client).toBeTruthy();
  });
});

describe("persistent kinds (lazy)", () => {
  it("a hotspot sits on its element and opens the content on click", async () => {
    document.body.innerHTML = `<button id="x">x</button>`;
    const { client, t } = boot([guide({ id: "h", kind: "hotspot", steps: [{ id: "a", title: "New export", body: "Try it", selector: "#x" }] })]);
    await vi.waitFor(() => expect(shadow().querySelector(".d")).toBeTruthy());
    expect(shadow().querySelector(".o")).toBeTruthy(); // hotspot outlines the element
    shadow().querySelector<HTMLElement>(".d")!.click();
    const panels = [...document.querySelectorAll<HTMLElement>("[data-lc-ignore]")].map((h) => h.shadowRoot!.textContent);
    expect(panels.join(" ")).toContain("Try it");
    await client.flush();
    expect(names(t)).toEqual(["$guide_shown", "$guide_step"]); // opening the content reports its step
  });

  it("a beacon has no outline; a badge dismisses itself for good", async () => {
    document.body.innerHTML = `<button id="x">x</button>`;
    const { client, t } = boot([
      guide({ id: "b1", kind: "beacon", steps: [{ id: "a", title: "Beacon", selector: "#x" }] }),
      guide({ id: "b2", kind: "badge", steps: [{ id: "a", title: "New", selector: "#x" }] }),
    ]);
    await vi.waitFor(() => expect(document.querySelectorAll("[data-lc-ignore]")).toHaveLength(2));
    const roots = [...document.querySelectorAll<HTMLElement>("[data-lc-ignore]")].map((h) => h.shadowRoot!);
    expect(roots.some((r) => r.querySelector(".o"))).toBe(false);
    roots.find((r) => r.querySelector(".b"))!.querySelector<HTMLElement>(".b")!.click();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-lc-ignore]")).toHaveLength(1));
    await client.flush();
    expect(t.events().filter((e) => e.event === "$guide_dismissed")).toHaveLength(1);
    expect(stored("lc_guide_dismissed")).toContain("b2");
  });

  it("a launcher opens a resource-center panel and closing it is not a dismissal", async () => {
    const { client, t } = boot([guide({ id: "l", name: "Help", kind: "launcher", steps: [{ id: "a", title: "Docs" }, { id: "b", title: "Chat" }] })]);
    await vi.waitFor(() => expect(shadow().querySelector(".l")).toBeTruthy());
    shadow().querySelector<HTMLElement>(".l")!.click();
    const panel = [...document.querySelectorAll<HTMLElement>("[data-lc-ignore]")].find((h) => h.shadowRoot!.textContent!.includes("Docs"))!;
    [...panel.shadowRoot!.querySelectorAll("button")].find((b) => b.textContent === "Close")!.click();
    expect(shadow().querySelector(".l")).toBeTruthy(); // still there
    await client.flush();
    expect(names(t)).toEqual(["$guide_shown"]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flags } from "../src/flags/index.js";
import { guides } from "../src/guides/index.js";
import { resetArbiter } from "../src/arbiter.js";
import { eligible, urlExcluded } from "../src/targeting.js";
import type { Client, Guide } from "../src/index.js";
import { startWith, tick } from "./helpers.js";

// Workflow-queued guides (`queued: true`) and project-wide `conditions.exclude_url_patterns`, served by the gateway.
const SUFFIX = "__pk_test"; // storage keys are namespaced per project key (lc_pk_test)
let live: Client | undefined;
beforeEach(() => {
  resetArbiter();
  localStorage.clear();
  document.body.innerHTML = "";
  history.replaceState({}, "", "/app/home");
});
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

const guide = (over: Partial<Guide> = {}): Guide => ({ id: "g", name: "G", kind: "modal", steps: [{ id: "a", title: "Hi" }], conditions: {}, ...over });
const shown = (): string | null => document.querySelector<HTMLElement>("[data-lc-ignore]")?.shadowRoot?.querySelector(".g")?.getAttribute("aria-label") ?? null;
const ctx = { url: "https://x.test/app/settings?tab=1", flags: () => false, lastShownMs: undefined, nowMs: Date.now(), random: () => 0.99 };

describe("exclude_url_patterns", () => {
  it("matches globs on the full URL and /-patterns on the path", () => {
    expect(urlExcluded("https://x.test/app/settings?tab=1", ["/app/settings*"])).toBe(true);
    expect(urlExcluded("https://x.test/app/settings", ["/app/*"])).toBe(true);
    expect(urlExcluded("https://x.test/app/home", ["/app/settings"])).toBe(false);
    expect(urlExcluded("https://x.test/checkout", ["https://x.test/check*"])).toBe(true);
    expect(urlExcluded("https://x.test/a.b", ["/a?b"])).toBe(false); // only * is special
    expect(urlExcluded("https://x.test/x", ["*"])).toBe(true);
    expect(urlExcluded("https://x.test/x", [])).toBe(false);
    expect(eligible({ conditions: { exclude_url_patterns: ["/app/settings"] } }, ctx)).toBe(false); // the query is not part of the path
    expect(eligible({ conditions: { exclude_url_patterns: ["/app/settings?tab=1"] } }, ctx)).toBe(true);
    expect(eligible({ conditions: { exclude_url_patterns: ["/app/*"] } }, ctx)).toBe(false);
  });

  it("never shows a guide on an excluded page, and sends the page url", async () => {
    const r = startWith([flags, guides], { _h: { "/v1/guides": { guides: [guide({ conditions: { exclude_url_patterns: ["/app/*"] } })] } } } as never);
    live = r.client;
    await tick(20);
    expect(shown()).toBeNull();
    const req = r.f.calls.find((c) => c.url.includes("/v1/guides?"))!;
    expect(new URL(req.url).searchParams.get("url")).toBe(`${location.origin}/app/home`);
  });
});

describe("queued guides", () => {
  it("show at once, ahead of other guides, skipping delay, sampling and wait_days", async () => {
    localStorage.setItem(`lc_guide_last${SUFFIX}`, String(Date.now())); // a guide was just shown
    const other = guide({ id: "other", steps: [{ id: "a", title: "Other" }] });
    const q = guide({ id: "q", queued: true, steps: [{ id: "a", title: "Queued" }], conditions: { delay_seconds: 600, sample_pct: 1, wait_days: 7 } });
    live = startWith([flags, guides], { persistence: "localStorage", _h: { "/v1/guides": { guides: [other, q] } } } as never).client;
    await tick(20);
    expect(shown()).toBe("Queued");
  });

  it("still honour targeting and the seen state", async () => {
    const q = guide({ id: "q", queued: true, conditions: { url: "/elsewhere" } });
    live = startWith([flags, guides], { _h: { "/v1/guides": { guides: [q] } } } as never).client;
    await tick(20);
    expect(shown()).toBeNull();
    await live.shutdown();
    localStorage.setItem(`lc_guide_seen${SUFFIX}`, JSON.stringify(["q2"]));
    live = startWith([flags, guides], { persistence: "localStorage", _h: { "/v1/guides": { guides: [guide({ id: "q2", queued: true })] } } } as never).client;
    await tick(20);
    expect(shown()).toBeNull();
  });
});

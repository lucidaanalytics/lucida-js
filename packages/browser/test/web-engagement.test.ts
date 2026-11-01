import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../src/index.js";
import { engagementTimer } from "../src/autocapture/engagement.js";
import { start } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => history.replaceState({}, "", "/home"));
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const setVisibility = (state: "visible" | "hidden"): void => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("engagement time (LC-WEB-15)", () => {
  it("counts visible time only and restarts on reset", () => {
    let t = 0;
    const timer = engagementTimer(() => t);
    t = 4000;
    setVisibility("hidden");
    t = 9000; // hidden: not counted
    expect(timer.read()).toBe(4000);
    setVisibility("visible");
    t = 10000;
    expect(timer.read()).toBe(5000);
    timer.reset();
    t = 10500;
    expect(timer.read()).toBe(500);
    timer.stop();
  });

  it("$pageleave carries $engagement_time_ms", async () => {
    const { client, t } = start({ autocapture: false });
    live = client;
    history.pushState({}, "", "/next");
    await client.flush();
    const leave = t.events().find((e) => e.event === "$pageleave");
    expect(typeof leave?.properties.$engagement_time_ms).toBe("number");
  });
});

describe("content blocks (LC-WEB-27)", () => {
  type Cb = (e: Array<{ isIntersecting: boolean; target: Element }>) => void;
  let fire: Cb = () => {};
  class FakeIO {
    constructor(cb: Cb) {
      fire = cb;
    }
    observe(): void {}
    disconnect(): void {}
  }

  it("sends one impression per block and an interaction on click, from attributes only", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    document.body.innerHTML = `<div id="hero" data-lc-content="Hero" data-lc-content-piece="spring-sale" data-lc-content-target="/sale">Secret text <input value="s3cret"></div>`;
    const { client, t } = start({});
    live = client;
    const hero = document.getElementById("hero") as Element;
    fire([{ isIntersecting: true, target: hero }]);
    fire([{ isIntersecting: true, target: hero }]); // already counted
    hero.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await client.flush();
    const ev = t.events().filter((e) => e.event.startsWith("$content_"));
    expect(ev.map((e) => e.event)).toEqual(["$content_impression", "$content_interaction"]);
    expect(ev[0]?.properties).toMatchObject({ $content_name: "Hero", $content_piece: "spring-sale", $content_target: "/sale" });
    expect(JSON.stringify(ev)).not.toContain("s3cret");
  });

  it("contentBlocks:false turns it off", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    document.body.innerHTML = `<div id="hero" data-lc-content="Hero"></div>`;
    const { client, t } = start({ autocapture: { contentBlocks: false } });
    live = client;
    document.getElementById("hero")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await client.flush();
    expect(t.events().some((e) => e.event.startsWith("$content_"))).toBe(false);
  });
});

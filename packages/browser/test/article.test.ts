import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { start } from "./helpers.js";

let live: Client | undefined;
beforeEach(() => history.replaceState({}, "", "/blog/post-1"));
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  document.body.innerHTML = "";
});

const rect = (el: Element, top: number, height: number): void => {
  el.getBoundingClientRect = () => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) });
};

describe("article read-through (N-DXA-6)", () => {
  it("sends one $article_read per article page when the route changes, from geometry only", async () => {
    document.body.innerHTML = `<article data-lc-region="article" data-lc-article-id="post-1"><h1>Secret headline</h1><p>text</p></article>`;
    const art = document.querySelector("article") as Element;
    const h1 = document.querySelector("h1") as Element;
    rect(art, 0, window.innerHeight * 4);
    rect(h1, 0, 40);
    const { client, t } = start({});
    live = client;
    // scrolled to the end: the article bottom is on screen and the headline is gone
    rect(art, -window.innerHeight * 3, window.innerHeight * 4);
    rect(h1, -window.innerHeight * 3, 40);
    window.dispatchEvent(new Event("scroll"));
    history.pushState({}, "", "/blog/post-2");
    window.dispatchEvent(new Event("scroll"));
    await client.flush();
    const reads = t.events().filter((e) => e.event === "$article_read");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.properties).toMatchObject({ $article_id: "post-1", $article_depth: 100, $article_finished: true, $article_headline_exit: false });
    expect(JSON.stringify(reads)).not.toContain("Secret headline");
  });

  it("counts a reader who never scrolled as a headline exit, and articles:false is off", async () => {
    document.body.innerHTML = `<div data-lc-region="article"><h2>Hi</h2></div>`;
    rect(document.querySelector("div") as Element, 0, window.innerHeight * 10);
    const { client, t } = start({});
    live = client;
    history.pushState({}, "", "/next");
    window.dispatchEvent(new Event("scroll"));
    await client.flush();
    expect(t.events().find((e) => e.event === "$article_read")?.properties).toMatchObject({ $article_id: "/blog/post-1", $article_depth: 10, $article_headline_exit: true });
    await client.shutdown();
    const off = start({ autocapture: { articles: false } });
    live = off.client;
    history.pushState({}, "", "/again");
    window.dispatchEvent(new Event("scroll"));
    await off.client.flush();
    expect(off.t.events().some((e) => e.event === "$article_read")).toBe(false);
  });
});

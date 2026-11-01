import { afterEach, describe, expect, it, vi } from "vitest";
import { isBotUserAgent } from "../src/bot-ua.js";
import { start } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("client-side bot blocking", () => {
  it("recognises crawler and headless user agents", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15")).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 (Linux; Android 12; CUBOT X50) Chrome/120 Mobile Safari/537.36")).toBe(false);
    expect(isBotUserAgent("")).toBe(false);
  });

  it("sends nothing from a bot unless blockBots is false", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (compatible; AhrefsBot/7.0)");
    const blocked = start({ capturePageview: false, autocapture: false, persistence: "memory" });
    blocked.client.capture("x");
    await blocked.client.flush();
    expect(blocked.t.events()).toHaveLength(0);
    await blocked.client.shutdown();
    const kept = start({ capturePageview: false, autocapture: false, persistence: "memory", blockBots: false });
    kept.client.capture("x");
    await kept.client.flush();
    expect(kept.t.events().map((e) => e.event)).toEqual(["x"]);
    await kept.client.shutdown();
  });
});

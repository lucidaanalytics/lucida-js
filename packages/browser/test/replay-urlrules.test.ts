import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { replay, resolveReplay } from "../src/replay/index.js";
import type { Client } from "../src/index.js";
import { pagePrivacy, urlRules } from "../src/replay/urlrules.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until, wait } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

function boot(remote: unknown) {
  document.body.innerHTML = `<p class="secret">ACCOUNT-SECRET</p><p class="open">public-copy</p>`;
  const f = replayFetch(remote);
  live = createClient(
    "lc_pk_test",
    { persistence: "memory", apiHost: "https://ingest.test", transport: fakeTransport(), fetch: f.fn, capturePageview: false, replay: { flush_interval_ms: 40 } },
    [replay],
  );
  return f;
}

describe("URL-scoped replay privacy rules (P-M16)", () => {
  it("combines every matching rule and ignores malformed ones", () => {
    const rules = urlRules([
      { url: "/account/*", mask_all_text: true },
      { url: "/account/billing", mask_selectors: [".iban"], block_selectors: ["#card"] },
      { url: 7 },
      null,
      { url: "/other", mask_selectors: [".x"] },
    ]);
    expect(rules).toHaveLength(3);
    const p = pagePrivacy(rules, "https://shop.test/account/billing?x=1");
    expect(p).toMatchObject({ maskAllText: true, mask: [".iban"], block: ["#card"] });
    expect(pagePrivacy(rules, "https://shop.test/pricing")).toMatchObject({ maskAllText: false, mask: [], block: [] });
    expect(pagePrivacy(rules, "https://shop.test/account/").key).not.toBe(p.key);
  });

  it("merges remote and local rules into the resolved config", () => {
    const r = resolveReplay({ url_privacy_rules: [{ url: "/a", mask_all_text: true }] }, { replay_url_privacy_rules: [{ url: "/b", mask_selectors: [".s"] }] });
    expect(r?.url_privacy_rules.map((x) => x.url)).toEqual(["/b", "/a"]);
    expect(resolveReplay({}, { replay_url_privacy_rules: "nope" })?.url_privacy_rules).toEqual([]);
  });

  it("masks the rule's selectors on a matching page and nothing extra elsewhere", async () => {
    const f = boot({ session_recording: true, replay_url_privacy_rules: [{ url: "/", mask_selectors: [".secret"] }] });
    await until(() => f.posts.length > 0);
    await wait(100);
    const all = f.posts.map((x) => x.raw).join("\n");
    expect(all).not.toContain("ACCOUNT-SECRET");
    expect(all).toContain("public-copy");
    await live?.shutdown();
    live = undefined;
    const g = boot({ session_recording: true, replay_url_privacy_rules: [{ url: "/nowhere-xyz", mask_all_text: true }] });
    await until(() => g.posts.length > 0);
    await wait(100);
    expect(g.posts.map((x) => x.raw).join("\n")).toContain("ACCOUNT-SECRET");
  });
});

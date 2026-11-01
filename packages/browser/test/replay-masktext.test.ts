import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { replay, resolveReplay } from "../src/replay/index.js";
import type { BrowserConfig, Client } from "../src/index.js";
import { textMasker } from "../src/replay/masktext.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until, wait } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

const PAGE = `<h1 title="TITLE-SECRET">HEADLINE-SECRET</h1>
<img alt="ALT-SECRET" src="data:,">
<button aria-label="ARIA-SECRET" value="BUTTON-VALUE-SECRET">BUTTON-SECRET</button>
<section data-lc-unmask><p title="unmasked-title">unmasked-copy</p><span data-lc-mask>INNER-MASKED-SECRET</span></section>
<nav class="menu"><a>menu-copy</a></nav>`;

function boot(cfg: BrowserConfig["replay"], remote: unknown = {}) {
  document.body.innerHTML = PAGE;
  const f = replayFetch(remote);
  live = createClient(
    "lc_pk_test",
    { persistence: "memory", apiHost: "https://ingest.test", transport: fakeTransport(), fetch: f.fn, capturePageview: false, replay: { flush_interval_ms: 40, ...cfg } },
    [replay],
  );
  return f;
}
const SECRETS = ["TITLE-SECRET", "HEADLINE-SECRET", "ALT-SECRET", "ARIA-SECRET", "BUTTON-VALUE-SECRET", "BUTTON-SECRET", "INNER-MASKED-SECRET", "MUTATED-SECRET", "MUTATED-ATTR-SECRET"];

describe("mask-all-text replay mode", () => {
  it("masks every text node and text attribute except the unmask allow-list, in snapshots and mutations", async () => {
    const f = boot({ mask_all_text: true, unmask_selectors: [".menu"] });
    await until(() => f.posts.length > 0);
    const p = document.createElement("p");
    p.textContent = "MUTATED-SECRET";
    document.body.appendChild(p);
    document.querySelector("h1")!.setAttribute("title", "MUTATED-ATTR-SECRET");
    await wait(200);
    const all = f.posts.map((x) => x.raw).join("\n");
    expect(all).toContain("unmasked-copy");
    expect(all).toContain("unmasked-title");
    expect(all).toContain("menu-copy");
    for (const s of SECRETS) expect(all, s).not.toContain(s);
  });

  it("is off by default; remote can force it on, and a '*' mask selector ignores the unmask list", async () => {
    expect(resolveReplay({}, null)?.mask_all_text).toBe(false);
    expect(resolveReplay({ mask_all_text: false }, { replay_mask_all_text: true })?.mask_all_text).toBe(true);
    expect(resolveReplay({}, { replay_mask_selectors: ["*"] })?.mask_all_text).toBe(true);
    expect(resolveReplay({ unmask_selectors: [".a"] }, { replay: { unmask_selectors: [".b"] } as never })?.unmask_selectors).toEqual([".a"]);
    const f = boot({ unmask_selectors: [".menu"] }, { session_recording: true, replay_mask_selectors: ["*"] });
    await until(() => f.posts.length > 0);
    await wait(100);
    const all = f.posts.map((x) => x.raw).join("\n");
    expect(all).not.toContain("menu-copy");
    expect(all).not.toContain("unmasked-copy");
  });

  it("fails closed when a node cannot be resolved", () => {
    const m = textMasker("[data-lc-mask]", "[data-lc-unmask]");
    const e = { type: 3, data: { source: 0, attributes: [{ id: 9, attributes: { title: "abc", value: "x y" } }] } };
    m.scrub(e, () => null);
    expect(e.data.attributes[0]!.attributes).toEqual({ title: "***", value: "* *" });
    expect(m.maskTextFn("hi there", null)).toBe("** *****");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { replay } from "../src/replay/index.js";
import type { Client } from "../src/index.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until, wait } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
});

describe("replay: shadow DOM (LC-EXP-25)", () => {
  it("records open shadow roots and masks inputs and masked text inside them", async () => {
    document.body.innerHTML = `<div id="host"></div><p>outside-copy</p>`;
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = `<p>shadow-visible-copy</p><input type="text" value="SHADOW-INPUT-SECRET"><p data-lc-mask>SHADOW-MASKED-TEXT</p><p class="srv-mask">SHADOW-SELECTOR-MASKED</p>`;
    const f = replayFetch({ replay_mask_selectors: [".srv-mask"] });
    live = createClient(
      "lc_pk_test",
      { persistence: "memory", apiHost: "https://ingest.test", transport: fakeTransport(), fetch: f.fn, capturePageview: false, replay: { flush_interval_ms: 40 } },
      [replay],
    );
    await until(() => f.posts.length > 0);
    const input = root.querySelector("input")!;
    input.value = "TYPED-IN-SHADOW";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await wait(150);
    const all = f.posts.map((p) => p.raw).join("\n");
    expect(all).toContain("shadow-visible-copy"); // the shadow tree is in the snapshot
    for (const secret of ["SHADOW-INPUT-SECRET", "TYPED-IN-SHADOW", "SHADOW-MASKED-TEXT", "SHADOW-SELECTOR-MASKED"]) {
      expect(all, secret).not.toContain(secret);
    }
  });
});

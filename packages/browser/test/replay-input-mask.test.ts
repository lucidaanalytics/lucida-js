import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { replay } from "../src/replay/index.js";
import type { Client } from "../src/index.js";
import { fakeTransport } from "./helpers.js";
import { replayFetch, until } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  document.body.innerHTML = "";
  await live?.shutdown();
  live = undefined;
  history.replaceState({}, "", "/");
});

describe("replay input masking", () => {
  it("masks inputs with a fixed-length placeholder and strips sensitive params from the meta href", async () => {
    history.replaceState({}, "", "/pricing.html?email=a%40b.c&password=hunter2&q=1");
    document.body.innerHTML = `<input type="password" value="hunter2-very-long-secret"><input type="text" value="x">`;
    const f = replayFetch({ session_recording: true, replay_sample_rate: 1 });
    live = createClient(
      "lc_pk_test",
      { persistence: "memory", apiHost: "https://ingest.test", transport: fakeTransport(), fetch: f.fn, capturePageview: false, replay: { flush_interval_ms: 40, mask_all_inputs: true } },
      [replay],
    );
    await until(() => f.posts.length > 0);
    const all = f.posts.map((x) => x.raw).join("\n");
    expect(all).toContain('"value":"********"');
    expect(all).not.toContain("hunter2-very-long-secret");
    expect(all).not.toContain("*".repeat(24));
    expect(all).not.toContain("hunter2&");
    expect(all).toContain("password=<masked>");
  });
});

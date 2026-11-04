import { afterEach, expect, it } from "vitest";
import { createClient } from "../src/index.js";
import { fakeFetch, fakeTransport, tick } from "./helpers.js";

let live: ReturnType<typeof createClient> | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
});

it("a core-only bundle fetches the config at init so the session definition applies", async () => {
  const f = fakeFetch({ "/v1/config": { session_idle_ms: 1000 } });
  live = createClient("lc_pk_test", { persistence: "memory", transport: fakeTransport(), fetch: f.fn, apiHost: "https://ingest.test" });
  await tick(10);
  expect(f.calls.filter((c) => c.url.includes("/v1/config"))).toHaveLength(1);
});

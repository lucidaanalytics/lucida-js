import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import type { Client } from "../src/index.js";
import { fakeTransport } from "./helpers.js";
import { until } from "./replay-helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  localStorage.clear();
});

function boot(body: Record<string, unknown>) {
  const t = fakeTransport();
  const urls: string[] = [];
  const f = (async (u: string) => (urls.push(u), new Response(JSON.stringify(body), { status: 200 }))) as unknown as typeof fetch;
  live = createClient("lc_pk_test", { persistence: "localStorage", transport: t, offlineQueue: false, apiHost: "https://ingest.test", fetch: f, consent: { geo: true } });
  return { t, client: live, urls };
}

describe("geo consent defaults (N-ANA-17)", () => {
  it("an opt_in region stores nothing and sends nothing before the visitor decides", async () => {
    const { client, t, urls } = boot({ consent_default: "opt_in", consent_country: "DE" });
    client.capture("early");
    await until(() => urls.some((u) => u.includes("/v1/config")));
    await new Promise((r) => setTimeout(r, 30)); // negative check: let the answer apply, nothing may follow
    expect(client.getConsentStatus()).toBe("pending");
    expect(client.getConsent().analytics).toBe(false);
    await client.flush();
    expect(t.events()).toHaveLength(0);
    expect(Object.keys(localStorage).filter((k) => k.startsWith("lc_"))).toEqual([]);
    client.optIn();
    await client.flush();
    expect(t.events().map((e) => e.event)).toContain("$opt_in");
  });

  it("an opt_out region releases held events once the config answers", async () => {
    const { client, t } = boot({ consent_default: "opt_out" });
    client.capture("early");
    await until(() => client.getConsent().analytics);
    await client.flush();
    expect(t.events().map((e) => e.event)).toContain("early");
  });
});

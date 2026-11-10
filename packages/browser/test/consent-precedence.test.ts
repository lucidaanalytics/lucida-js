import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import type { BrowserConfig, Client } from "../src/index.js";
import { fakeTransport } from "./helpers.js";
import { until } from "./replay-helpers.js";

const v = JSON.parse(readFileSync(resolve(process.env.LUCIDA_TESTDATA ?? resolve(process.cwd(), "../../testdata"), "consent/precedence.json"), "utf8")) as {
  cases: Array<{ name: string; page_mode: "opt_in" | "opt_out" | null; project_mode: string | null; geo: string | null; effective: string }>;
};

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  localStorage.clear();
});

function boot(body: Record<string, unknown> | null, consent?: BrowserConfig["consent"]) {
  const t = fakeTransport();
  const fetched: Array<{ url: string; init?: RequestInit }> = [];
  let answer: (() => void) | undefined;
  const gate = new Promise<void>((r) => (answer = r));
  const f = (async (url: string, init?: RequestInit) => {
    fetched.push({ url, ...(init ? { init } : {}) });
    await gate;
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;
  live = createClient("lc_pk_test", { persistence: "localStorage", transport: t, offlineQueue: false, apiHost: "https://ingest.test", fetch: f, capturePageview: false, autocapture: false, ...(consent ? { consent } : {}) });
  return { client: live, t, fetched, answer: () => answer?.() };
}
const lcKeys = () => Object.keys(localStorage).filter((k) => k.startsWith("lc_"));

describe("consent precedence vector (F6)", () => {
  for (const c of v.cases) {
    it(c.name, async () => {
      const body = { ...(c.project_mode ? { consent_mode: c.project_mode } : {}), ...(c.geo ? { consent_default: c.geo } : {}) };
      const { client, t, fetched, answer } = boot(body, c.page_mode ? { mode: c.page_mode } : undefined);
      client.capture("early");
      client.register({ k: "v" });
      if (c.page_mode !== "opt_in") {
        // nothing stored or sent until the config answers; the config fetch carries only the public key
        expect(lcKeys()).toEqual([]);
        expect(t.events()).toHaveLength(0);
        expect(fetched).toHaveLength(1);
        expect(fetched[0]!.init?.credentials).toBe("omit");
        expect(fetched[0]!.url).toBe("https://ingest.test/v1/config?api_key=lc_pk_test");
      }
      answer();
      await new Promise((r) => setTimeout(r, 30));
      await client.flush();
      if (c.effective === "opt_out") {
        await until(() => client.getConsent().analytics);
        await client.flush();
        expect(t.events().map((e) => e.event)).toContain("early");
      } else {
        expect(client.getConsent().analytics).toBe(false);
        expect(client.consentStatus()).toBe("pending");
        // cookieless sends anonymously (no ids); opt_in sends nothing
        const early = t.events().filter((e) => e.event === "early");
        expect(early).toHaveLength(c.effective === "cookieless" ? 1 : 0);
        for (const e of early) expect(e).not.toHaveProperty("distinct_id");
        expect(lcKeys()).toEqual([]);
        if (c.effective === "opt_in") {
          client.optIn();
          await client.flush();
          expect(t.events().map((e) => e.event)).toContain("$opt_in");
        }
      }
    });
  }

  it("fails closed when the config does not answer, and a stored decision skips the wait", async () => {
    localStorage.setItem("lc_consent__pk_test", JSON.stringify({ analytics: true, replay: true, marketing: true }));
    const stored = boot(null);
    expect(stored.client.getConsent().analytics).toBe(true);
    await stored.client.shutdown();
    localStorage.clear();
    const { client, t, answer } = boot(null);
    client.capture("early");
    answer(); // a 500 answer: no mode learned
    await new Promise((r) => setTimeout(r, 30));
    await client.flush();
    expect(t.events()).toHaveLength(0);
    expect(lcKeys()).toEqual([]);
  });
});

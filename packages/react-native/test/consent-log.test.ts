import { expect, it } from "vitest";
import { createClient } from "../src/index.js";

const mk = async (logBeacon: boolean) => {
  const sent: string[] = [];
  const fetchFn = (async (_u: string, i: { body: string }) => (sent.push(i.body), { status: 200 })) as unknown as typeof fetch;
  const c = await createClient("k", { fetch: fetchFn, flushAt: 1, consent: { mode: "opt_in", logBeacon } });
  return { c, sent };
};

it("optIn sends $consent_updated; optOut sends an anonymous beacon only with logBeacon", async () => {
  const a = await mk(true);
  a.c.optIn();
  await a.c.flush();
  expect(a.sent.join("")).toContain("$consent_updated");
  a.sent.length = 0;
  a.c.optOut();
  await new Promise((r) => setTimeout(r, 10));
  const beacon = a.sent.find((b) => b.includes("$consent_updated"));
  expect(beacon).toBeDefined();
  expect(beacon).not.toContain("distinct_id");
  const b = await mk(false);
  b.c.optOut();
  await new Promise((r) => setTimeout(r, 10));
  expect(b.sent.join("")).not.toContain("$consent_updated");
});

import { describe, expect, it } from "vitest";
import { readOverrides } from "../src/index.js";

/**
 * Live check of the Flags Explorer override cookie (G216, docs/guides/live-verification.md). Set an override
 * in the Vercel Toolbar of a deployed project that uses this adapter, copy the `vercel-flag-overrides` cookie
 * from the browser, and run with:
 *   LC_LIVE_VERCEL_FLAGS_SECRET      the project's FLAGS_SECRET
 *   LC_LIVE_VERCEL_OVERRIDE_COOKIE   the cookie value the toolbar wrote
 *   LC_LIVE_VERCEL_EXPECTED          optional JSON of the overrides you set, e.g. {"new-checkout":true}
 *   LC_LIVE_VERCEL_APP_URL           optional deployment URL: its /.well-known/vercel/flags must refuse anonymous calls
 * Skips when the secret or cookie is unset.
 */
const env = process.env;
const secret = env.LC_LIVE_VERCEL_FLAGS_SECRET;
const cookie = env.LC_LIVE_VERCEL_OVERRIDE_COOKIE;

describe.skipIf(!secret || !cookie)("live: Vercel Flags Explorer overrides", () => {
  it("decrypts the cookie the toolbar wrote with FLAGS_SECRET", async () => {
    const o = await readOverrides(cookie, secret);
    expect(Object.keys(o).length).toBeGreaterThan(0);
    if (env.LC_LIVE_VERCEL_EXPECTED) expect(o).toEqual(JSON.parse(env.LC_LIVE_VERCEL_EXPECTED));
  });

  it("rejects the cookie under a different secret (a visitor cannot forge overrides)", async () => {
    const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await readOverrides(cookie, other)).toEqual({});
  });

  it.skipIf(!env.LC_LIVE_VERCEL_APP_URL)("the flags discovery endpoint refuses anonymous calls", async () => {
    const r = await fetch(new URL("/.well-known/vercel/flags", env.LC_LIVE_VERCEL_APP_URL));
    expect([401, 403]).toContain(r.status);
  });
});

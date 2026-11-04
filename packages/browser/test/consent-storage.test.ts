import { afterEach, describe, expect, it } from "vitest";
import { init } from "../src/index.js";
import { fakeTransport } from "./helpers.js";

const lc = (): string[] => document.cookie.split("; ").filter((c) => c.startsWith("lc_")).map((c) => c.split("=")[0]!);
const wipe = (): void => {
  for (const n of lc()) document.cookie = `${n}=; Max-Age=0; Path=/`;
  localStorage.clear();
  sessionStorage.clear();
};

describe("opt_in storage", () => {
  afterEach(wipe);

  it("writes nothing while pending, keeps only the decision cookie after deny", () => {
    const c = init("lc_pk_cs1", { apiHost: "https://i.test", transport: fakeTransport(), persistence: "cookie", consent: { mode: "opt_in" } });
    c.getSessionId();
    c.capture("x");
    expect(lc()).toEqual([]);
    expect(localStorage.length + sessionStorage.length).toBe(0);
    c.setConsent({ analytics: true });
    c.capture("y");
    expect(lc().length).toBeGreaterThan(1);
    c.setConsent({ analytics: false, replay: false, marketing: false });
    expect(lc()).toEqual(["lc_consent_c_pk_cs1"]);
  });
});

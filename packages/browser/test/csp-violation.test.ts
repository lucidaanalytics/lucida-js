import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { startWith, tick } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
});

function violate(init: Partial<Record<string, unknown>>): void {
  const e = new Event("securitypolicyviolation");
  Object.assign(e, { effectiveDirective: "script-src-elem", disposition: "enforce", ...init });
  document.dispatchEvent(e);
}

describe("$csp_violation capture", () => {
  it("is off by default", async () => {
    const { client, t } = startWith([]);
    live = client;
    violate({ blockedURI: "https://evil.test/x.js?token=1" });
    await client.flush();
    await tick();
    expect(t.events().some((e) => e.event === "$csp_violation")).toBe(false);
  });

  it("sends origin + path only, drops duplicates and caps the volume", async () => {
    const { client, t } = startWith([], { captureCspViolations: { maxPerPage: 2 } });
    live = client;
    violate({ blockedURI: "https://evil.test/x.js?token=secret#h", sourceFile: "https://app.test/a.js?v=1", lineNumber: 7, sample: "secret code" });
    violate({ blockedURI: "https://evil.test/x.js?token=other", sourceFile: "https://app.test/a.js?v=2", lineNumber: 7 });
    violate({ blockedURI: "inline", effectiveDirective: "style-src-elem" });
    violate({ blockedURI: "eval", effectiveDirective: "script-src" });
    await client.flush();
    await tick();
    const got = t.events().filter((e) => e.event === "$csp_violation");
    expect(got).toHaveLength(2);
    expect(got[0]?.properties).toMatchObject({
      $csp_directive: "script-src-elem",
      $csp_blocked_uri: "https://evil.test/x.js",
      $csp_source_file: "https://app.test/a.js",
      $csp_line: 7,
    });
    expect(JSON.stringify(got)).not.toContain("secret");
    expect(got[1]?.properties.$csp_blocked_uri).toBe("inline");
  });

  it("extensionPersistence keeps a content script out of page storage", () => {
    localStorage.clear();
    const { client } = startWith([], { extension: true, persistence: "cookie", extensionPersistence: "memory" });
    live = client;
    client.capture("x");
    expect(Object.keys(localStorage).filter((k) => k.startsWith("lc_"))).toEqual([]);
  });
});

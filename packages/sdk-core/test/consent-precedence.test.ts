import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveConsentDefault } from "../src/index.js";
import type { ConsentMode } from "../src/index.js";

const dir = process.env.LUCIDA_TESTDATA ?? new URL("../../../testdata", import.meta.url).pathname;
const v = JSON.parse(readFileSync(`${dir}/consent/precedence.json`, "utf8")) as {
  default_page_mode: ConsentMode;
  cases: Array<{ name: string; page_mode: ConsentMode | null; project_mode: string | null; geo: string | null; effective: string }>;
};

describe("consent precedence vector", () => {
  for (const c of v.cases) {
    it(c.name, () => {
      const page = c.page_mode ?? v.default_page_mode;
      expect(resolveConsentDefault(page, c.project_mode ?? undefined, c.geo ?? undefined) ?? page).toBe(c.effective);
    });
  }
});

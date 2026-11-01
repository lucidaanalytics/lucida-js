import { defineConfig } from "vitest/config";

// Real Chromium via Playwright against the built bundle (run `pnpm build` first; `pnpm e2e` does both).
export default defineConfig({
  test: { environment: "node", include: ["e2e/**/*.e2e.ts"], testTimeout: 60_000 },
});

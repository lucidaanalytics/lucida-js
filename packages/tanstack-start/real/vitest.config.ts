import { defineConfig } from "vitest/config";

// Real-framework checks: not part of `pnpm test`; the lucida-js CI job installs the router and runs `vitest run -c real/vitest.config.ts`.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["real/*.real.ts"],
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } },
  },
});

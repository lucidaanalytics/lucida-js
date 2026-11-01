import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // Node >= 25 ships a global localStorage that shadows jsdom's; disable it so jsdom's is used.
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } },
  },
});

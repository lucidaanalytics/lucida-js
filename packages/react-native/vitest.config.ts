import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "react-native": fileURLToPath(new URL("./test/support/react-native.tsx", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // Node >= 25 ships a global localStorage that shadows jsdom's; harmless here, kept for parity.
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] } },
  },
});

import { defineConfig } from "tsup";

// sdk-core is bundled in so the published package has no private runtime dependency.
export default defineConfig({
  entry: { index: "src/index.ts", middleware: "src/middleware.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  noExternal: ["@lucida-analytics/sdk-core"],
});

import { defineConfig } from "tsup";

// Workspace deps are bundled in so the published package has no private runtime dependency.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  noExternal: [/^@lucida-analytics\//],
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  noExternal: ["@lucida-analytics/sdk-core", "@lucida-analytics/edge"],
  external: ["react", "react/jsx-runtime", "@lucida-analytics/browser", "@lucida-analytics/react"],
});

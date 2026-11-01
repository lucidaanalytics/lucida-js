import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  noExternal: ["@lucida/sdk-core", "@lucida/edge"],
  external: ["react", "react/jsx-runtime", "@lucida/browser", "@lucida/react"],
});

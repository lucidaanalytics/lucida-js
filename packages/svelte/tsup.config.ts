import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", server: "src/server.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  external: ["@lucida/browser"],
  noExternal: ["@lucida/edge", "@lucida/sdk-core"],
});

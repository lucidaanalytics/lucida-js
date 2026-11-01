import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "runtime/plugin": "src/runtime/plugin.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  external: ["vue", "@lucida/browser", "@lucida/vue"],
});

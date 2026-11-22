import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", page: "src/page.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
});

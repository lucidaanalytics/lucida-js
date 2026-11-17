import { defineConfig } from "tsup";

// Every export uses hooks, so the whole bundle is a client module. esbuild drops source-level
// "use client" directives when bundling, so it is re-added as a banner (as in @lucida-analytics/next).
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  external: ["react", "react/jsx-runtime", "@lucida-analytics/browser"],
  banner: { js: '"use client";' },
});

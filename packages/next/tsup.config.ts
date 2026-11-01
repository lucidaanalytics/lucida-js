import { defineConfig } from "tsup";

// `client` carries the "use client" directive (esbuild drops it from bundles, so it is re-added as a banner).
const common = { format: ["esm" as const], dts: true, target: "es2022", noExternal: ["@lucida/sdk-core"] };
export default defineConfig([
  { ...common, entry: { index: "src/index.ts", server: "src/server.ts" }, clean: true },
  { ...common, entry: { client: "src/client.tsx" }, banner: { js: '"use client";' } },
]);

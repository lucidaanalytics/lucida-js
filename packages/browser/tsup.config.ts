import { defineConfig } from "tsup";

// platform browser: fflate's node entry would pull `module`/worker_threads into the lazy chunk
const common = { format: ["esm" as const], dts: false, minify: true, target: "es2022", platform: "browser" as const, noExternal: ["@lucida-analytics/sdk-core"] };

// sdk-core is bundled in (noExternal) so the published package has no private runtime dependency.
// Each non-replay entry is self-contained (splitting off) so its gzip size is its real cost.
// `replay` and `consent` are the lazy ones (the consent banner is a separate chunk): dist/replay.js is the small loader, the rrweb recorder is a separate chunk.
// Build with `rm -rf dist && tsup` (the package script); neither config cleans, so they can run in parallel.
// One declarations run for every entry, so the entries share a single types chunk (separate dts runs each
// emitted their own copy of the whole type graph).
const dtsEntries = {
  index: "src/index.ts",
  core: "src/core-entry.ts",
  autocapture: "src/autocapture/index.ts",
  flags: "src/flags/index.ts",
  experiments: "src/experiments/index.ts",
  "early-access": "src/early-access/index.ts",
  webmcp: "src/webmcp/index.ts",
  recommendations: "src/recs/index.ts",
  heatmaps: "src/heatmaps/index.ts",
  forms: "src/forms/index.ts",
  toolbar: "src/toolbar/index.ts",
  inspector: "src/inspector/index.ts",
  correlate: "src/watchtower/correlate.ts",
  "host-headers": "src/host-headers.ts",
  replay: "src/replay/index.ts",
  consent: "src/consent/index.ts",
  guides: "src/guides/index.ts",
};

export default defineConfig([
  { format: ["esm"], entry: dtsEntries, dts: { only: true }, platform: "browser", noExternal: ["@lucida-analytics/sdk-core"] },
  {
    ...common,
    entry: {
      index: "src/index.ts",
      core: "src/core-entry.ts",
      autocapture: "src/autocapture/index.ts",
      flags: "src/flags/index.ts",
      experiments: "src/experiments/index.ts",
      "early-access": "src/early-access/index.ts",
      webmcp: "src/webmcp/index.ts",
      recommendations: "src/recs/index.ts",
      heatmaps: "src/heatmaps/index.ts",
      forms: "src/forms/index.ts",
      toolbar: "src/toolbar/index.ts",
      inspector: "src/inspector/index.ts",
      correlate: "src/watchtower/correlate.ts",
      "host-headers": "src/host-headers.ts",
    },
    splitting: false,
  },
  {
    ...common,
    entry: { replay: "src/replay/index.ts", consent: "src/consent/index.ts" },
    splitting: true,
    // the recorder is bundled with its deps (rrweb, fflate) into the lazy chunk
    noExternal: ["@lucida-analytics/sdk-core", "@rrweb/record", "fflate"],
  },
  {
    // `guides` splits too: the persistent kinds (hotspot, beacon, badge, launcher) are a lazy chunk.
    ...common,
    entry: { guides: "src/guides/index.ts" },
    splitting: true,
  },
  {
    // Classic script for tag managers (GTM template): dist/lucida.js drains window.lucidaQueue.
    ...common,
    format: ["iife"],
    dts: false,
    entry: { lucida: "src/snippet.ts" },
    outExtension: () => ({ js: ".js" }),
  },
]);

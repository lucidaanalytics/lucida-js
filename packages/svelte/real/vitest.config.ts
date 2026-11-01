import { defineConfig } from "vitest/config";

// Real-framework checks: not part of `pnpm test`; the lucida-js CI job installs the framework and runs `vitest run -c real/vitest.config.ts`.
export default defineConfig({ test: { include: ["real/*.real.ts"] } });

#!/usr/bin/env node
// `npx @lucida-analytics/cli <args>` or `lucida <args>` after `npm i -g`: runs the native CLI with these args.
import { spawnSync } from "node:child_process";
import { ensureBinary } from "../lib/install.js";

try {
  const r = spawnSync(await ensureBinary(), process.argv.slice(2), { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.signal) process.kill(process.pid, r.signal);
  process.exit(r.status ?? 1);
} catch (e) {
  process.stderr.write(`lucida: ${e.message}\n`);
  process.exit(1);
}

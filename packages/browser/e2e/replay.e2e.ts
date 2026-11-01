import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real Chromium + the built bundle (dist/) + a stub ingest server. Run via `pnpm e2e` (builds first).
const DIST = new URL("../dist/", import.meta.url);

const PAGE = `<!doctype html><html><body style="height:3000px">
<h1>page-visible-copy</h1>
<form id="f"><label for="u">User</label><input id="u" name="user" type="text">
<input id="pw" name="password" type="password"><input id="prefilled" value="PREFILLED-VALUE-ATTR">
<textarea id="ta"></textarea></form>
<p data-lc-mask>MASKED-COPY-XYZ</p><div data-lc-block>BLOCKED-COPY-XYZ</div>
<button id="b">Click me</button>
<script type="module">
  import { createClient, autocapture } from "/dist/index.js";
  import { replay } from "/dist/replay.js";
  import { heatmaps } from "/dist/heatmaps.js";
  import { forms } from "/dist/forms.js";
  createClient("lc_pk_e2e", { apiHost: location.origin, persistence: "memory", replay: { flush_interval_ms: 200 } },
    [autocapture, heatmaps, forms, replay]);
  window.__ready = true;
</script></body></html>`;

interface Chunk { session_id: string; window_id: string; seq: number; events: Array<{ type: number; data?: { tag?: string; payload?: { height?: number } } }> }
const chunks: Array<{ raw: string; chunk: Chunk }> = [];
const batches: string[] = [];
const requested: string[] = [];
let server: Server;
let browser: Browser;
let origin = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    requested.push(url.pathname);
    const body: Buffer[] = [];
    req.on("data", (c: Buffer) => body.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(body);
      if (url.pathname === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
      if (url.pathname.startsWith("/dist/")) {
        try {
          return void res.writeHead(200, { "content-type": "text/javascript" }).end(readFileSync(new URL(url.pathname.slice(6), DIST)));
        } catch {
          return void res.writeHead(404).end();
        }
      }
      if (url.pathname === "/v1/config") return void res.writeHead(200, { "content-type": "application/json" }).end("{}");
      if (url.pathname === "/v1/replay") {
        const raw = (url.searchParams.get("compression") === "gzip" ? gunzipSync(buf) : buf).toString("utf8");
        chunks.push({ raw, chunk: JSON.parse(raw) as Chunk });
      }
      if (url.pathname === "/v1/batch") batches.push(buf.toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" }).end('{"status":1}');
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});

describe("replay in real Chromium", () => {
  it("records the page lazily, and no secret ever appears in the chunk bytes", async () => {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => (window as { __ready?: boolean }).__ready === true);
    await page.fill("#u", "alice-typed-USERNAME");
    await page.fill("#pw", "hunter2-TYPED-PASSWORD");
    await page.fill("#ta", "TEXTAREA-TYPED-SECRET");
    await page.click("#b");
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(1200);
    await page.goto("about:blank"); // pagehide: remaining events leave by sendBeacon
    await page.waitForTimeout(600);

    expect(requested.some((p) => /\/dist\/recorder-.*\.js$/.test(p))).toBe(true); // lazy chunk was fetched
    expect(chunks.length, requested.join(",")).toBeGreaterThan(0);
    const all = chunks.map((c) => c.raw).join("\n");
    expect(all).toContain("page-visible-copy"); // it recorded for real
    for (const secret of [
      "alice-typed-USERNAME",
      "hunter2-TYPED-PASSWORD",
      "TEXTAREA-TYPED-SECRET",
      "PREFILLED-VALUE-ATTR",
      "MASKED-COPY-XYZ",
      "BLOCKED-COPY-XYZ",
    ]) {
      expect(all, secret).not.toContain(secret);
    }
    // monotonic seq from 0, one snapshot, real document height for scroll-depth math (G16)
    expect(chunks.map((c) => c.chunk.seq)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.raw.length < 10_000_000)).toBe(true);
    const events = chunks.flatMap((c) => c.chunk.events);
    expect(events.some((e) => e.type === 2)).toBe(true);
    const heights = events.filter((e) => e.type === 5 && e.data?.tag === "page_height").map((e) => e.data?.payload?.height ?? 0);
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(3000);

    // form + click analytics carry no values either
    const analytics = batches.join("\n");
    expect(analytics).toContain("$form_field_interact");
    expect(analytics).toContain("$click_x");
    for (const secret of ["alice-typed-USERNAME", "hunter2-TYPED-PASSWORD", "TEXTAREA-TYPED-SECRET"]) expect(analytics).not.toContain(secret);
    await page.close();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { webmcp, wrapTool } from "../src/webmcp/index.js";
import type { WebMcpTool } from "../src/webmcp/index.js";
import { startWith } from "./helpers.js";

type Nav = { modelContext?: unknown };
let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
  delete (navigator as Nav).modelContext;
});

function fakeModelContext() {
  const tools: WebMcpTool[] = [];
  const mc = {
    provideContext(ctx: { tools?: WebMcpTool[] }) {
      tools.splice(0, tools.length, ...(ctx.tools ?? []));
    },
    registerTool(t: WebMcpTool) {
      tools.push(t);
    },
  };
  (navigator as Nav).modelContext = mc;
  return tools;
}

describe("WebMCP agent actions (P-M43)", () => {
  it("captures tool calls without inputs or results and marks the session", async () => {
    const tools = fakeModelContext();
    const s = startWith([webmcp]);
    live = s.client;
    const ctx = (navigator as Nav).modelContext as { registerTool(t: WebMcpTool): void; provideContext(c: { tools: WebMcpTool[] }): void };
    ctx.registerTool({ name: "add_to_cart", description: "Add", execute: async (input: unknown) => ({ ok: true, echo: input }) });
    ctx.provideContext({ tools: [{ name: "search", execute: () => { throw new Error("boom"); } }, ...tools] });
    await tools.find((t) => t.name === "add_to_cart")!.execute!({ sku: "SECRET-SKU" });
    expect(() => tools.find((t) => t.name === "search")!.execute!({ q: "SECRET-Q" })).toThrow("boom");
    s.client.capture("checkout_started");
    await s.client.flush();
    const evs = s.t.events();
    const actions = evs.filter((e) => e.event === "$agent_action");
    expect(actions.map((a) => [a.properties.tool, a.properties.status])).toEqual([
      ["add_to_cart", "ok"],
      ["search", "error"],
    ]);
    expect(typeof actions[0]!.properties.duration_ms).toBe("number");
    expect(JSON.stringify(evs)).not.toContain("SECRET");
    expect(evs.find((e) => e.event === "checkout_started")!.properties.$agent_session).toBe(true);
  });

  it("is inert without navigator.modelContext and never wraps twice", async () => {
    const s = startWith([webmcp]);
    live = s.client;
    s.client.capture("x");
    await s.client.flush();
    expect(s.t.events()[0]!.properties.$agent_session).toBeUndefined();
    let calls = 0;
    const once = wrapTool({ name: "t", execute: () => 1 }, () => calls++);
    const twice = wrapTool(once, () => calls++);
    expect(twice).toBe(once);
    twice.execute!();
    expect(calls).toBe(1);
  });
});

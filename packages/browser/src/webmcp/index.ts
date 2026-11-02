import type { Host, Module } from "../types.js";

/**
 * WebMCP agent-action capture (P-M43). Sites expose tools to in-browser AI agents through
 * `navigator.modelContext` (`provideContext({tools})` / `registerTool(tool)`, W3C WebMCP draft). This module wraps
 * every tool's `execute` so each agent call emits `$agent_action {tool, status, duration_ms}` and marks the session
 * as agent-driven: every later event of the session carries `$agent_session: true` (lc-enrich turns that into the
 * server-owned `$agent_driven`). Tool inputs and results are never read. Load it before the site registers tools
 * (tools registered earlier are not wrapped).
 */
export interface WebMcpTool {
  name: string;
  execute?: (...args: unknown[]) => unknown;
  [k: string]: unknown;
}

interface ModelContext {
  provideContext?: (ctx: { tools?: WebMcpTool[] | undefined; [k: string]: unknown }) => unknown;
  registerTool?: (tool: WebMcpTool) => unknown;
}

const KEY = "lc_agent_session";
const WRAPPED = Symbol.for("lucida.webmcp.wrapped");
const marked = (f: unknown): Record<symbol, unknown> => f as Record<symbol, unknown>;
const MAX_NAME = 200;

/** A copy of `tool` whose execute reports to `onCall`; anything else on the tool is kept as-is. */
export function wrapTool(tool: WebMcpTool, onCall: (name: string, ok: boolean, ms: number) => void): WebMcpTool {
  const run = tool.execute;
  if (typeof run !== "function" || marked(run)[WRAPPED]) return tool;
  const name = String(tool.name ?? "").slice(0, MAX_NAME);
  const execute = function (this: unknown, ...args: unknown[]): unknown {
    const t0 = performance.now();
    const done = (ok: boolean): void => onCall(name, ok, Math.round(performance.now() - t0));
    let out: unknown;
    try {
      out = run.apply(this, args);
    } catch (e) {
      done(false);
      throw e;
    }
    if (out && typeof (out as Promise<unknown>).then === "function") {
      (out as Promise<unknown>).then(
        () => done(true),
        () => done(false),
      );
    } else done(true);
    return out;
  };
  marked(execute)[WRAPPED] = true;
  return { ...tool, execute };
}

export const webmcp: Module = (host: Host) => {
  const mc = (navigator as { modelContext?: ModelContext }).modelContext;
  if (!mc) return;
  const { core } = host;
  const agentSession = (): string | null => {
    try {
      return core.storage.get(KEY) ?? null;
    } catch {
      return null;
    }
  };
  // sessions rotate: only the session the agent acted in is marked
  host.eventExtras.push((sid) => (agentSession() === sid ? { $agent_session: true } : {}));
  const onCall = (tool: string, ok: boolean, ms: number): void => {
    try {
      core.storage.set(KEY, core.sessionId);
    } catch {
      /* storage blocked: only this event is marked */
    }
    host.client.capture("$agent_action", { tool, status: ok ? "ok" : "error", duration_ms: ms, $agent_session: true, $agent_protocol: "webmcp" });
  };
  const { provideContext, registerTool } = mc;
  if (typeof provideContext === "function") {
    mc.provideContext = function (this: unknown, ctx) {
      const list = ctx?.tools;
      const tools = Array.isArray(list) ? list.map((t) => wrapTool(t, onCall)) : list;
      return provideContext.call(this, { ...ctx, tools });
    };
  }
  if (typeof registerTool === "function") {
    mc.registerTool = function (this: unknown, tool) {
      return registerTool.call(this, tool && typeof tool === "object" ? wrapTool(tool, onCall) : tool);
    };
  }
  return () => {
    if (provideContext) mc.provideContext = provideContext;
    if (registerTool) mc.registerTool = registerTool;
  };
};

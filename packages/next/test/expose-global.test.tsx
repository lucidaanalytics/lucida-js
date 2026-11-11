// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LucidaNextProvider } from "../src/client.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const g = globalThis as Record<string, unknown>;
const opts = { persistence: "memory", autocapture: false, capturePageview: false, disabled: true } as const;
afterEach(() => delete g.lucida);

async function mount(key: string, options: object) {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<LucidaNextProvider apiKey={key} options={{ ...opts, ...options }} />));
  await act(async () => root.unmount());
}

describe("LucidaNextProvider exposeGlobal", () => {
  it("exposes window.lucida by default", async () => {
    await mount("lc_pk_next_g1", {});
    expect(typeof (g.lucida as { getSessionId?: unknown } | undefined)?.getSessionId).toBe("function");
  });
  it("can be switched off", async () => {
    await mount("lc_pk_next_g2", { exposeGlobal: false });
    expect(g.lucida).toBeUndefined();
  });
});

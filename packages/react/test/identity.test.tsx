// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "@lucida-analytics/browser";
import { LucidaProvider } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("LucidaProvider identify prop", () => {
  it("identifies on sign-in, resets only on sign-out, never on signed-out renders", async () => {
    const identify = vi.fn();
    const reset = vi.fn();
    const client = { identify, reset, onFlags: () => () => {} } as unknown as Client;
    const root = createRoot(document.createElement("div"));
    const render = (id: string | null | undefined) => act(async () => root.render(<LucidaProvider client={client} identify={id} identifyProps={{ plan: "pro" }} />));
    await render(null);
    await render(undefined);
    expect(reset).not.toHaveBeenCalled();
    await render("u1");
    await render("u1");
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith("u1", { plan: "pro" });
    await render("");
    await render(null);
    expect(reset).toHaveBeenCalledTimes(1);
    await render("u2");
    expect(identify).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });
});

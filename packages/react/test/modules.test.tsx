// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { Module } from "@lucida-analytics/browser";
import { LucidaProvider } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("LucidaProvider modules", () => {
  it("passes modules as the third init argument", async () => {
    let ran = false;
    const mod: Module = () => {
      ran = true;
      return () => {};
    };
    const root = createRoot(document.createElement("div"));
    await act(async () =>
      root.render(<LucidaProvider apiKey="lc_pk_react_mod1" options={{ persistence: "memory", autocapture: false, capturePageview: false }} modules={[mod]} />),
    );
    await act(async () => root.unmount());
    expect(ran).toBe(true);
  });
});

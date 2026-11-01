import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LucidaMask, LucidaProvider, LucidaTouchCapture, LucidaUnmask, replayMarker } from "../src/index.js";
import type { NativeClient } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => createRoot(el).render(node));
  return el;
}

describe("replay mask markers", () => {
  it("uses the native marker values per platform", () => {
    expect(replayMarker("mask", "ios")).toBe("lucida-sensitive");
    expect(replayMarker("unmask", "ios")).toBe("lucida-unmask");
    expect(replayMarker("mask", "android")).toBe("lc-mask");
    expect(replayMarker("unmask", "android")).toBe("lc-unmask");
  });

  it("<LucidaMask> and <LucidaUnmask> mark their subtree through testID", async () => {
    const el = await mount(
      <LucidaUnmask>
        <LucidaMask>secret</LucidaMask>
      </LucidaUnmask>,
    );
    expect(el.querySelector('[data-testid="lucida-unmask"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="lucida-sensitive"]')?.textContent).toBe("secret");
  });

  it("<LucidaTouchCapture> feeds touches to client.replay.tap", async () => {
    const tap = vi.fn();
    const client = { replay: { tap }, onFlags: () => () => {} } as unknown as NativeClient;
    const el = await mount(
      <LucidaProvider client={client}>
        <LucidaTouchCapture>
          <span>child</span>
        </LucidaTouchCapture>
      </LucidaProvider>,
    );
    await act(async () => {
      el.querySelector("span")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 34 }));
    });
    expect(tap).toHaveBeenCalledWith(12, 34);
  });
});

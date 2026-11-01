import type { Client } from "@lucida/browser";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureOnViewed, Feature, LucidaProvider } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let observers: Array<{ cb: (e: Array<{ isIntersecting: boolean }>) => void; disconnect: ReturnType<typeof vi.fn> }> = [];
beforeEach(() => {
  observers = [];
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    disconnect = vi.fn();
    constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) {
      observers.push({ cb, disconnect: this.disconnect });
    }
    observe() {}
  };
});
afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

function fakeClient(flags: Record<string, unknown> = {}) {
  const capture = vi.fn();
  const featureView = vi.fn();
  const featureInteraction = vi.fn();
  const client = { capture, featureView, featureInteraction, getFlag: (k: string) => flags[k], onFlags: () => () => {} } as unknown as Client;
  return { client, capture, featureView, featureInteraction };
}

async function mount(client: Client, ui: React.ReactNode, flags: Record<string, never> = {}) {
  const el = document.createElement("div");
  await act(async () => {
    createRoot(el).render(
      <LucidaProvider client={client} bootstrapFlags={flags}>
        {ui}
      </LucidaProvider>,
    );
  });
  return el;
}

describe("CaptureOnViewed", () => {
  it("captures once when visible, with properties", async () => {
    const { client, capture } = fakeClient();
    await mount(client, <CaptureOnViewed event="banner_seen" properties={{ id: 1 }}>hi</CaptureOnViewed>);
    act(() => observers[0]!.cb([{ isIntersecting: false }]));
    expect(capture).not.toHaveBeenCalled();
    act(() => observers[0]!.cb([{ isIntersecting: true }]));
    expect(capture).toHaveBeenCalledWith("banner_seen", { id: 1 });
    expect(observers[0]!.disconnect).toHaveBeenCalled();
  });

  it("repeat keeps observing and defaults to $element_viewed", async () => {
    const { client, capture } = fakeClient();
    await mount(client, <CaptureOnViewed repeat>hi</CaptureOnViewed>);
    act(() => observers[0]!.cb([{ isIntersecting: true }]));
    act(() => observers[0]!.cb([{ isIntersecting: true }]));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith("$element_viewed", undefined);
  });
});

describe("Feature", () => {
  it("renders children only when the flag matches and fires view then a single interaction", async () => {
    const { client, featureView, featureInteraction } = fakeClient({ f: "b" });
    const el = await mount(client, <Feature flag="f" match="b" fallback={<i>no</i>}><button>go</button></Feature>, { f: "b" } as never);
    expect(el.textContent).toBe("go");
    act(() => observers[0]!.cb([{ isIntersecting: true }]));
    expect(featureView).toHaveBeenCalledWith("f");
    act(() => el.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => el.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(featureInteraction).toHaveBeenCalledTimes(1);
  });

  it("shows the fallback and sends nothing when the flag does not match", async () => {
    const { client, featureView } = fakeClient({ f: "a" });
    const el = await mount(client, <Feature flag="f" match="b" fallback={<i>no</i>}>yes</Feature>, { f: "a" } as never);
    expect(el.textContent).toBe("no");
    expect(observers).toHaveLength(0);
    expect(featureView).not.toHaveBeenCalled();
  });

  it("trackView/trackInteraction can be turned off", async () => {
    const { client, featureView, featureInteraction } = fakeClient({ f: true });
    const el = await mount(client, <Feature flag="f" trackView={false} trackInteraction={false}><button>go</button></Feature>, { f: true } as never);
    act(() => observers[0]!.cb([{ isIntersecting: true }]));
    act(() => el.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(featureView).not.toHaveBeenCalled();
    expect(featureInteraction).not.toHaveBeenCalled();
  });
});

import type { Client } from "@lucida-analytics/browser";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LucidaProvider, useReplay } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useReplay", () => {
  it("forwards to client.replay", async () => {
    const calls: string[] = [];
    const replay = {
      start: async () => void calls.push("start"),
      stop: () => calls.push("stop"),
      pause: () => calls.push("pause"),
      resume: () => calls.push("resume"),
      tag: (n: string) => calls.push(`tag:${n}`),
      isRecording: () => true,
    };
    const client = { replay, getFlag: () => undefined, onFlags: () => () => {} } as unknown as Client;
    let api: ReturnType<typeof useReplay> | undefined;
    function Probe() {
      api = useReplay();
      return null;
    }
    await act(async () => {
      createRoot(document.createElement("div")).render(
        <LucidaProvider client={client}>
          <Probe />
        </LucidaProvider>,
      );
    });
    await api!.start();
    api!.pause();
    api!.resume();
    api!.tag("x");
    api!.stop();
    expect(calls).toEqual(["start", "pause", "resume", "tag:x", "stop"]);
    expect(api!.isRecording()).toBe(true);
  });

  it("is inert without a client", async () => {
    let api: ReturnType<typeof useReplay> | undefined;
    function Probe() {
      api = useReplay();
      return null;
    }
    await act(async () => {
      createRoot(document.createElement("div")).render(
        <LucidaProvider>
          <Probe />
        </LucidaProvider>,
      );
    });
    await api!.start();
    api!.tag("x");
    expect(api!.isRecording()).toBe(false);
  });
});

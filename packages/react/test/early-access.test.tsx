import type { Client, EarlyAccessFeature } from "@lucida-analytics/browser";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LucidaProvider, useEarlyAccess } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useEarlyAccess", () => {
  it("lists features and forwards opt-in/out to client.earlyAccess", async () => {
    const calls: string[] = [];
    const list: EarlyAccessFeature[] = [{ flag_key: "f1", name: "F1", stage: "beta", enrolled: false }];
    const client = {
      earlyAccess: {
        list: async () => list,
        optIn: (k: string) => calls.push(`in:${k}`),
        optOut: (k: string) => calls.push(`out:${k}`),
      },
      getFlag: () => undefined,
      onFlags: () => () => {},
    } as unknown as Client;
    let api: ReturnType<typeof useEarlyAccess> | undefined;
    function Probe() {
      api = useEarlyAccess();
      return <span>{api.features.map((f) => `${f.flag_key}:${String(f.enrolled)}`).join(",")}</span>;
    }
    const el = document.createElement("div");
    await act(async () => {
      createRoot(el).render(
        <LucidaProvider client={client}>
          <Probe />
        </LucidaProvider>,
      );
    });
    expect(el.textContent).toBe("f1:false");
    await act(async () => api!.optIn("f1"));
    expect(el.textContent).toBe("f1:true");
    await act(async () => api!.optOut("f1"));
    expect(calls).toEqual(["in:f1", "out:f1"]);
  });
});

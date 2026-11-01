import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { FeatureGate, LucidaProvider, createClient, useCapture, useFeatureFlag, useScreen } from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("react-native provider", () => {
  it("creates the client async and exposes flags, capture and screen hooks", async () => {
    const sent: string[] = [];
    const options = {
      apiHost: "https://ingest.test",
      flushAt: 1,
      transport: {
        send: async (_u: string, body: string) => {
          sent.push(...(JSON.parse(body) as { batch: Array<{ event: string }> }).batch.map((e) => e.event));
          return { status: 200 };
        },
      },
      fetch: (async () => ({ ok: true, status: 200, json: async () => ({ flags: { beta: { enabled: true, value: true } } }) })) as unknown as typeof fetch,
    };
    let capture: ReturnType<typeof useCapture> | undefined;
    function Probe() {
      capture = useCapture();
      useScreen("Home");
      const v = useFeatureFlag("beta");
      return <FeatureGate flag="beta" fallback={<i id="off" />}><b id="on">{String(v)}</b></FeatureGate>;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => {
      root.render(<LucidaProvider apiKey="k" options={options}><Probe /></LucidaProvider>);
      await tick();
    });
    await act(async () => tick());
    expect(el.querySelector("#on")?.textContent).toBe("true");
    capture?.("clicked");
    await tick();
    expect(sent).toContain("clicked");
    expect(sent).toContain("$screen");
    expect(sent).toContain("$feature_flag_called");
    await act(async () => root.unmount());
  });

  it("accepts an existing client and hooks throw outside the provider", async () => {
    const client = await createClient("k", { disabled: true });
    const el = document.createElement("div");
    const root = createRoot(el);
    function P() {
      return <i>{client.distinctId.length > 0 ? "ok" : "no"}</i>;
    }
    await act(async () => root.render(<LucidaProvider client={client}><P /></LucidaProvider>));
    expect(el.textContent).toBe("ok");
    function Bad() {
      useCapture();
      return null;
    }
    const r2 = createRoot(document.createElement("div"));
    const err = console.error;
    console.error = () => undefined;
    await expect(act(async () => r2.render(<Bad />))).rejects.toThrow(/LucidaProvider/);
    console.error = err;
  });
});

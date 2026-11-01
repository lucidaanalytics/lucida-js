import { init } from "@lucida/browser";
import type { Client } from "@lucida/browser";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FeatureGate, LucidaProvider, useActiveFeatureFlags, useCapture, useFeatureFlag, useFeatureFlagPayload,
  useFeatureFlagVariant, useLucida,
} from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flagsBody = {
  flags: {
    beta: { enabled: true, value: true, payload: { color: "red" } },
    exp: { enabled: true, variant: "b", value: "b" },
    off: { enabled: false, value: false },
  },
  request_id: "r1",
};

function setup(flagsDelayMs = 20) {
  const sent: Array<{ event: string; properties: Record<string, unknown> }> = [];
  let key = 0;
  const client: Client = init(`lc_pk_${key++}`, {
    persistence: "memory",
    apiHost: "https://ingest.test",
    autocapture: false,
    capturePageview: false,
    flushAt: 1,
    transport: {
      send: async (_u, body) => {
        sent.push(...(JSON.parse(body) as { batch: typeof sent }).batch);
        return { status: 200 };
      },
    },
    fetch: (async (url: string) => {
      await new Promise((r) => setTimeout(r, flagsDelayMs));
      return new Response(JSON.stringify(url.includes("/v1/flags") ? flagsBody : {}), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { client, sent };
}

let root: Root;
let el: HTMLElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(() => act(() => root.unmount()));

const render = (ui: ReactNode) => act(async () => root.render(ui));
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

function Probe() {
  const beta = useFeatureFlag("beta");
  const variant = useFeatureFlagVariant("exp");
  const payload = useFeatureFlagPayload("beta");
  const active = useActiveFeatureFlags();
  return <p>{JSON.stringify({ beta, variant, payload, active })}</p>;
}

describe("hooks", () => {
  it("re-render when flags load and record the exposure", async () => {
    const { client, sent } = setup();
    await render(<LucidaProvider client={client}><Probe /></LucidaProvider>);
    expect(JSON.parse(el.textContent!)).toMatchObject({ active: [] });
    expect(JSON.parse(el.textContent!).beta).toBeUndefined();
    await wait(60);
    expect(JSON.parse(el.textContent!)).toEqual({
      beta: true, variant: "b", payload: { color: "red" }, active: ["beta", "exp"],
    });
    expect(sent.filter((e) => e.event === "$feature_flag_called").map((e) => e.properties.$feature_flag).sort()).toEqual(["beta", "exp"]);
  });

  it("bootstrapFlags render immediately and reach the owned client", async () => {
    await render(<LucidaProvider apiKey="lc_pk_boot" bootstrapFlags={{ beta: true }} options={{ persistence: "memory", autocapture: false, capturePageview: false, disabled: true }}><Probe /></LucidaProvider>);
    expect(JSON.parse(el.textContent!).beta).toBe(true);
  });

  it("FeatureGate matches on-values, variants and falls back", async () => {
    const { client } = setup(0);
    await render(
      <LucidaProvider client={client}>
        <FeatureGate flag="beta" fallback={<i>no-beta</i>}>beta-on</FeatureGate>
        <FeatureGate flag="exp" variant="b">exp-b</FeatureGate>
        <FeatureGate flag="exp" variant="a" fallback={<i>not-a</i>}>exp-a</FeatureGate>
        <FeatureGate flag="off" fallback={<i>off-fallback</i>}>off-on</FeatureGate>
      </LucidaProvider>,
    );
    await wait(30);
    expect(el.textContent).toBe("beta-onexp-bnot-aoff-fallback");
  });

  it("useCapture is stable and sends events; useLucida returns the client", async () => {
    const { client, sent } = setup(0);
    const seen: unknown[] = [];
    function Btn() {
      const capture = useCapture();
      const c = useLucida();
      seen.push(capture, c);
      return <button onClick={() => capture("clicked", { a: 1 })}>go</button>;
    }
    await render(<LucidaProvider client={client}><Btn /></LucidaProvider>);
    await act(async () => el.querySelector("button")!.click());
    await wait(5);
    expect(sent.find((e) => e.event === "clicked")?.properties).toMatchObject({ a: 1 });
    expect(seen[1]).toBe(client);
    expect(new Set(seen.filter((_, i) => i % 2 === 0)).size).toBe(1);
  });

  it("throws outside a provider", async () => {
    const err = console.error;
    console.error = () => undefined;
    await expect(render(<Probe />)).rejects.toThrow(/LucidaProvider/);
    console.error = err;
  });
});

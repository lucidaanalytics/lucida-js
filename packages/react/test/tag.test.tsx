import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const identify = vi.fn();
const init = vi.fn();
vi.mock("@lucida-analytics/browser", () => ({ init: (...a: unknown[]) => init(...a) }));
vi.mock("@lucida-analytics/browser/consent", () => ({ cookieMunchConsent: () => {} }));

async function mount(el: JSX.Element) {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(el));
  await act(async () => {});
  return root;
}

describe("LucidaTag", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockReset();
    identify.mockReset();
    init.mockReturnValue({ identify });
  });

  it("does nothing without a key", async () => {
    const { LucidaTag } = await import("../src/index.js");
    await mount(<LucidaTag publicKey="" />);
    expect(init).not.toHaveBeenCalled();
  });

  it("inits once across two mounts with merged defaults", async () => {
    const { LucidaTag } = await import("../src/index.js");
    await mount(<LucidaTag publicKey="lc_pk_a" options={{ apiHost: "/ingest" }} />);
    await mount(<LucidaTag publicKey="lc_pk_a" />);
    expect(init).toHaveBeenCalledTimes(1);
    const [key, cfg] = init.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toBe("lc_pk_a");
    expect(cfg).toMatchObject({ consent: { mode: "opt_in" }, referralParams: [], exposeGlobal: true, apiHost: "/ingest" });
  });

  it("swallows init failure", async () => {
    init.mockImplementation(() => {
      throw new Error("boom");
    });
    const { LucidaTag } = await import("../src/index.js");
    const root = await mount(<LucidaTag publicKey="lc_pk_b" />);
    expect(root).toBeDefined();
    expect(identify).not.toHaveBeenCalled();
  });

  it("identifies after init and again when uid changes", async () => {
    const { LucidaTag } = await import("../src/index.js");
    const root = await mount(<LucidaTag publicKey="lc_pk_c" uid="u1" />);
    expect(identify).toHaveBeenCalledWith("u1");
    await act(async () => root.render(<LucidaTag publicKey="lc_pk_c" uid="u2" />));
    await act(async () => {});
    expect(identify).toHaveBeenLastCalledWith("u2");
  });
});

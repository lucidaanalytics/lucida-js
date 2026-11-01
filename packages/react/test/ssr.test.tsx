// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeatureGate, LucidaProvider, useCapture, useFeatureFlag } from "../src/index.js";

describe("SSR", () => {
  it("has no window, so importing and rendering must not touch it", () => {
    expect(typeof window).toBe("undefined");
  });

  it("renders bootstrap flags on the server without creating a client", () => {
    function C() {
      useCapture()("noop"); // must be a safe no-op while rendering on the server
      return <span>{String(useFeatureFlag("beta"))}</span>;
    }
    const html = renderToString(
      <LucidaProvider apiKey="lc_pk_ssr" bootstrapFlags={{ beta: true, exp: "b" }}>
        <C />
        <FeatureGate flag="exp" variant="b" fallback="fallback">variant-b</FeatureGate>
        <FeatureGate flag="missing" fallback={<em>fb</em>}>x</FeatureGate>
      </LucidaProvider>,
    );
    expect(html).toContain("true");
    expect(html).toContain("variant-b");
    expect(html).toContain("<em>fb</em>");
  });

  it("renders the fallback with no bootstrap", () => {
    const html = renderToString(<LucidaProvider apiKey="k"><FeatureGate flag="a" fallback="fb">on</FeatureGate></LucidaProvider>);
    expect(html).toBe("fb");
  });
});

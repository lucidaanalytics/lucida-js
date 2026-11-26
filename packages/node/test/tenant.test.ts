import { afterEach, describe, expect, it, vi } from "vitest";
import { assignVariant, tenantBucket, tenantEvent } from "../src/index.js";

const X = "0190f3a0-0000-7000-8000-00000000abcd";

describe("assignVariant", () => {
  // Vectors computed independently (Python hashlib) from the documented algorithm.
  it("matches the documented hash", () => {
    expect(tenantBucket(X, "visitor-1")).toBeCloseTo(0.282428, 6);
    expect(tenantBucket(X, "visitor-5")).toBeCloseTo(0.941937, 6);
  });

  it("splits by cumulative weight", () => {
    const even = { id: X, variants: [{ key: "a" }, { key: "b" }] };
    expect(assignVariant("visitor-3", even)).toBe("a");
    expect(assignVariant("visitor-5", even)).toBe("b");
    const skew = { id: X, variants: [{ key: "a", weight: 1 }, { key: "b", weight: 3 }] };
    expect(assignVariant("visitor-1", skew)).toBe("b");
    expect(assignVariant("visitor-3", skew)).toBe("a");
    const three = { id: X, variants: [{ key: "a" }, { key: "b" }, { key: "c" }] };
    expect(["visitor-6", "visitor-8", "visitor-7"].map((b) => assignVariant(b, three))).toEqual(["a", "b", "c"]);
  });

  it("is stable, stops on the control, and handles no variants", () => {
    const e = { id: X, variants: [{ key: "a" }, { key: "b" }] };
    expect(assignVariant("visitor-5", e)).toBe(assignVariant("visitor-5", e));
    expect(assignVariant("visitor-5", { ...e, status: "stopped" })).toBe("a");
    expect(assignVariant("v", { id: X, variants: [] })).toBeUndefined();
  });
});

describe("tenantEvent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts snake_case events to the project route with the secret key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: 1, rejected: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await tenantEvent(
      { tenantId: "creator-42", event: "click", target: "link-7", value: 2, experimentId: "x", variant: "b" },
      { apiKey: "lc_sk_x", projectId: "p1", host: "https://cap.test/" },
    );
    expect(r).toMatchObject({ ok: true, accepted: 1, rejected: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cap.test/v1/projects/p1/tenant-events");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer lc_sk_x");
    const ev = JSON.parse(init.body as string).events[0];
    expect(ev).toMatchObject({ tenant_id: "creator-42", event: "click", target: "link-7", value: 2, experiment_id: "x", variant: "b" });
    expect(ev.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(ev).not.toHaveProperty("distinct_id");
  });

  it("never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await tenantEvent({ tenantId: "t", event: "e" }, { apiKey: "k", projectId: "p" })).toEqual({ ok: false, error: "down" });
    expect((await tenantEvent({ tenantId: "t", event: "e" }, { projectId: "p", apiKey: "" })).ok).toBe(false);
  });
});

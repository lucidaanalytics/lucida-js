// Runs against the REAL @tanstack/react-router (installed by the lucida-js CI job, never a dependency of this package):
// `trackRouter` must accept a real router and see its resolved navigations and route ids.
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { trackRouter } from "../src/pageviews.js";

describe("trackRouter with the real TanStack Router", () => {
  it("captures the loaded page and each navigation with the route template", async () => {
    const root = createRootRoute();
    const index = createRoute({ getParentRoute: () => root, path: "/" });
    const post = createRoute({ getParentRoute: () => root, path: "/posts/$postId" });
    const router = createRouter({ routeTree: root.addChildren([index, post]), history: createMemoryHistory({ initialEntries: ["/"] }) });
    await router.load();
    const seen: Array<Record<string, unknown> | undefined> = [];
    const off = trackRouter(router, { capture: (_e, p) => void seen.push(p) });
    await router.navigate({ to: "/posts/$postId", params: { postId: "7" } });
    off();
    expect(seen.map((p) => p?.$route)).toEqual(["/", "/posts/$postId"]);
  });
});

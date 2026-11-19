import { expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  throw new Error("react-native must not load from the root entry");
});

it("importing the root entry never loads react-native", async () => {
  const root = await import("../src/index.js");
  expect(typeof root.createClient).toBe("function");
  expect("LucidaGuides" in root).toBe(false);
});

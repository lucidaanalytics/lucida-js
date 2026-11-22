import { describe, expect, it, vi } from "vitest";
import { expoConfig } from "../src/defaults.js";
import type { ExpoDeps } from "../src/defaults.js";

const storage = { multiGet: async () => [], setItem: async () => {}, removeItem: async () => {} };
const base = (over: Partial<ExpoDeps> = {}): ExpoDeps => ({
  storage: () => storage,
  appState: { currentState: "active", addEventListener: () => ({ remove() {} }) } as unknown as ExpoDeps["appState"],
  platform: { OS: "ios", Version: "18.1" },
  constants: { expoConfig: { version: "1.4.0" }, executionEnvironment: "standalone" },
  application: { nativeApplicationVersion: "1.4.0", nativeBuildVersion: "42" },
  native: { capture: async () => "", installInfo: async () => null } as unknown as ExpoDeps["native"],
  ...over,
});

describe("expoConfig", () => {
  it("fills storage, app state, version, build and platform", () => {
    const c = expoConfig(base());
    expect(c).toMatchObject({ asyncStorage: storage, platform: "ios", osVersion: "18.1", appVersion: "1.4.0", appBuild: "42" });
    expect(c.installInfo).toBeTypeOf("function");
  });

  it("wires replay to the native module in a build", () => {
    const d = base();
    expect(expoConfig(d, { replay: { enabled: true } }).replay?.module).toBe(d.native);
  });

  it("in Expo Go: no native module, no Expo Go build number, replay off with a warning", () => {
    const warn = vi.fn();
    const c = expoConfig(base({ constants: { expoConfig: { version: "1.4.0" }, executionEnvironment: "storeClient" }, application: { nativeApplicationVersion: "2.32", nativeBuildVersion: "999" }, warn }), { replay: { enabled: true } });
    expect(c.replay).toBeUndefined();
    expect(c.appVersion).toBe("1.4.0");
    expect(c.appBuild).toBeUndefined();
    expect(c.installInfo).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("options win over the defaults", () => {
    const own = { ...storage };
    expect(expoConfig(base(), { asyncStorage: own, appVersion: "9" })).toMatchObject({ asyncStorage: own, appVersion: "9" });
  });
});

import type { Module } from "../types.js";

/** Registers `client.consent.showBanner()`. The banner itself is a separate chunk, fetched on the first call. */
export const consentBanner: Module = (host) => {
  host.consentUi = {
    showBanner: async (opts) => (await import("./banner.js")).showBanner(host, opts),
    hideBanner: () => void import("./banner.js").then((m) => m.hideBanner()),
  };
};

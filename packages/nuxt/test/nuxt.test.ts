import { createApp } from "vue";
import { describe, expect, it } from "vitest";
import { COMPOSABLES, lucidaModule, lucidaPlugin, useLucida } from "../src/index.js";
import type { NuxtLike } from "../src/index.js";

function fakeNuxt() {
  const hooks: Record<string, (i: Array<{ name: string; from: string }>) => void> = {};
  const nuxt: NuxtLike = {
    options: { plugins: [], runtimeConfig: { public: {} }, build: { transpile: [] } },
    hook: (n, fn) => void (hooks[n] = fn),
  };
  return { nuxt, hooks };
}

describe("@lucida/nuxt", () => {
  it("module registers the plugin, runtime config, transpile rule and composable auto-imports", () => {
    const { nuxt, hooks } = fakeNuxt();
    lucidaModule({ apiKey: "lc_pk_x", options: { disabled: true } }, nuxt);
    expect(nuxt.options.runtimeConfig.public.lucida).toEqual({ apiKey: "lc_pk_x", options: { disabled: true } });
    const plugin = nuxt.options.plugins[0] as { src: string; mode: string };
    expect(plugin.src).toBe("@lucida/nuxt/runtime/plugin");
    expect(plugin.mode).toBe("all");
    expect(nuxt.options.build.transpile.some((t) => t instanceof RegExp && t.test("@lucida/vue"))).toBe(true);
    const imports: Array<{ name: string; from: string }> = [];
    hooks["imports:extend"]!(imports);
    expect(imports.map((i) => i.name)).toEqual([...COMPOSABLES]);
  });

  it("module keeps existing public.lucida values (env overrides) and lets options win only where given", () => {
    const { nuxt } = fakeNuxt();
    nuxt.options.runtimeConfig.public.lucida = { apiKey: "from-env", bootstrapFlags: { a: true } };
    lucidaModule({ options: { debug: true } }, nuxt);
    expect(nuxt.options.runtimeConfig.public.lucida).toEqual({ apiKey: "from-env", bootstrapFlags: { a: true }, options: { debug: true } });
  });

  it("plugin installs the Vue plugin from runtime config; composables work and the client is inert with no key", () => {
    const vueApp = createApp({ render: () => null });
    lucidaPlugin({ vueApp, $config: { public: {} } });
    let got: unknown = "unset";
    vueApp.runWithContext(() => void (got = useLucida()));
    expect(got).toBeNull();
    const app2 = createApp({ render: () => null });
    lucidaPlugin({ vueApp: app2, $config: { public: { lucida: { apiKey: "lc_pk_x", options: { disabled: true, persistence: "memory" } } } } });
    app2.runWithContext(() => void (got = useLucida()));
    expect(got).not.toBeNull();
  });
});

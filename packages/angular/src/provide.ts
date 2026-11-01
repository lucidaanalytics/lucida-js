import { LucidaService } from "./service.js";
import type { LucidaConfig } from "./service.js";

/** A provider literal Angular's `providers: []` accepts, typed locally so no Angular import is needed. */
export interface LucidaProvider {
  provide: typeof LucidaService;
  useFactory: () => LucidaService;
}

/**
 * Standalone API: `bootstrapApplication(App, { providers: [provideLucida({ apiKey, options })] })`
 * (or `providers` of any NgModule). Inject with `inject(LucidaService)`. The service is created
 * lazily on first injection; inject it once at startup (e.g. an APP_INITIALIZER) to capture the first pageview early.
 */
export function provideLucida(config: LucidaConfig): LucidaProvider[] {
  return [{ provide: LucidaService, useFactory: () => new LucidaService(config) }];
}

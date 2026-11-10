// Types for the classic script (`<script src=".../lucida.js">`): the `window.lucidaQueue` stub and the `window.lucida` client.
// Add it to a TypeScript project with `/// <reference types="@lucida-analytics/browser/lucida-global" />`
// or `"types": ["@lucida-analytics/browser/lucida-global"]` in tsconfig.json.
import type { BrowserConfig, Client } from "./dist/index.js";

/** `["init", publicKey, config?]`: starts the client; `config.modules` are loaded (and integrity-checked) first. */
export type LucidaInitCommand = ["init", publicKey: string, config?: BrowserConfig];

/** `[method, ...args]`: any `Client` method, for example `["capture", "signed_up", { plan: "pro" }]`. Queued until `init` ran. */
export type LucidaMethodCommand = { [M in keyof Client]: Client[M] extends (...args: infer A) => unknown ? [method: M, ...args: A] : never }[keyof Client];

export type LucidaCommand = LucidaInitCommand | LucidaMethodCommand;

/** The queue before the script loads is a plain array; afterwards `push` runs the command at once. */
export type LucidaQueue = LucidaCommand[];

declare global {
  interface Window {
    /** Create it as `window.lucidaQueue = window.lucidaQueue || []` before the script loads. */
    lucidaQueue?: LucidaQueue;
    /** Set by the script once `init` has run (after any `modules` loaded). */
    lucida?: Client;
  }
}

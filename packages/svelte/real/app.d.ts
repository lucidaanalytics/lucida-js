import type { LucidaLocals } from "../src/server.js";

// What an app declares in its own app.d.ts (documented on LucidaLocals).
declare global {
  namespace App {
    interface Locals {
      lucida?: LucidaLocals;
    }
  }
}

export {};

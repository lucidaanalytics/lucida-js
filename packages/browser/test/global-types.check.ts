// Compile-time check of lucida-global.d.ts (tsgo --noEmit includes this file; it is not a vitest test).
import type { LucidaCommand } from "../lucida-global.js";

const q: LucidaCommand[] = [
  ["init", "lc_pk_x", { apiHost: "https://capture.example.com", modules: ["consent", "replay"] }],
  ["capture", "signed_up", { plan: "pro" }],
  ["identify", "u1"],
];
window.lucidaQueue = q;
window.lucida?.capture("e");
// @ts-expect-error not a Client method
const bad: LucidaCommand = ["nope", 1];
void bad;

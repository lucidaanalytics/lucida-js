import type { NativeClient } from "./types.js";

/** Pure core of `useExpoRouterScreens`: segments (template form, e.g. `["profile","[id]"]`) -> one `$screen` per change. */
export function expoRouterScreens(client: Pick<NativeClient, "screen">): (segments: readonly string[]) => void {
  let last: string | undefined;
  return (segments) => {
    // Route groups `(tabs)` are not part of the URL but identify the screen; they stay in the name.
    const name = "/" + segments.join("/");
    if (name === last) return;
    last = name;
    client.screen(name);
  };
}

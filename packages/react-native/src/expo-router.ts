// Subpath `@lucida-analytics/react-native/expo-router`: the only file that imports expo-router (optional peer).
import { useEffect, useRef } from "react";
import { useSegments } from "expo-router";
import { expoRouterScreens } from "./expo-router-screens.js";
import type { NativeClient } from "./types.js";

/** Sends one `$screen` per route template (`/profile/[id]`, never the real param value); consecutive repeats are skipped. */
export function useExpoRouterScreens(client: Pick<NativeClient, "screen"> | null): void {
  const segments = useSegments() as string[];
  const track = useRef<ReturnType<typeof expoRouterScreens> | null>(null);
  if (client && !track.current) track.current = expoRouterScreens(client);
  const key = segments.join("/");
  useEffect(() => track.current?.(segments), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

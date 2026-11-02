import { useContext, useRef } from "react";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { LucidaContext } from "./provider.js";

/**
 * Markers the native encoders already honour (iOS accessibilityIdentifier, Android view tag), applied through `testID`
 * (which also stops React Native from flattening the view away). They replace any `testID` on the wrapper, so put your
 * own `testID` on a child. Unmask never overrides mask or secure fields, at any depth.
 */
export const REPLAY_MARKERS = {
  ios: { mask: "lucida-sensitive", unmask: "lucida-unmask" },
  android: { mask: "lc-mask", unmask: "lc-unmask" },
} as const;

export const replayMarker = (kind: "mask" | "unmask", os: string = Platform.OS): string => REPLAY_MARKERS[os === "android" ? "android" : "ios"][kind];

export interface MarkProps {
  children?: ReactNode;
  style?: unknown;
}

/** Never show this subtree in replay: text is dropped and images/inputs are masked, whatever the global switches say. */
export function LucidaMask({ children, style }: MarkProps) {
  return (
    <View testID={replayMarker("mask")} collapsable={false} style={style}>
      {children}
    </View>
  );
}

/** Show this subtree's text, input values (never secure ones) and images in replay even with the global masks on. */
export function LucidaUnmask({ children, style }: MarkProps) {
  return (
    <View testID={replayMarker("unmask")} collapsable={false} style={style}>
      {children}
    </View>
  );
}

type TouchLike = { nativeEvent?: { pageX?: number; pageY?: number } };
const point = (e: TouchLike): { x: number; y: number } | null => {
  const n = e.nativeEvent;
  return n && typeof n.pageX === "number" && typeof n.pageY === "number" ? { x: n.pageX, y: n.pageY } : null;
};
const TOUCH_SLOP = 10;

/**
 * Wrap the app root to feed taps to `client.replay.tap` (the replay touch overlay) and swipes to the `$dead_swipe` check.
 * It only observes touch events bubbling up from children; it never becomes the responder, so no touch is cancelled or delayed.
 */
export function LucidaTouchCapture({ children, style }: MarkProps) {
  const client = useContext(LucidaContext)?.client;
  const swipe = useRef<{ x: number; y: number; began: boolean } | null>(null);
  return (
    <View
      collapsable={false}
      style={style ?? { flex: 1 }}
      onTouchStart={(e: TouchLike) => {
        const p = point(e);
        swipe.current = p ? { ...p, began: false } : null;
      }}
      onTouchMove={(e: TouchLike) => {
        const s = swipe.current;
        const p = point(e);
        if (!client || !s || !p || s.began || Math.hypot(p.x - s.x, p.y - s.y) <= TOUCH_SLOP) return;
        s.began = true;
        client.replay.swipeBegan();
      }}
      onTouchEnd={(e: TouchLike) => {
        const p = point(e);
        const s = swipe.current;
        swipe.current = null;
        if (!client || !p) return;
        client.replay.tap(p.x, p.y);
        if (s?.began) client.replay.swipeEnded(p.x - s.x, p.y - s.y);
      }}
    >
      {children}
    </View>
  );
}

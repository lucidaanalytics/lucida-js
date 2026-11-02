import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import type { Rect } from "./guide-theme.js";

// Anchor targets for mobile guides (N-DAP-10). React Native cannot look a view up by testID from JS, so a view a
// guide may point at is wrapped in <GuideAnchor testID="...">: it registers its native view here and the guide view
// measures it in window coordinates. A step's `native_id` is that testID.

/** What a registered anchor must do: React Native host views implement measureInWindow. */
export interface Measurable {
  measureInWindow(cb: (x: number, y: number, width: number, height: number) => void): void;
}

const anchors = new Map<string, Measurable>();

/** Register a view under `id` (the latest mount wins). Returns the unregister. */
export function registerAnchor(id: string, m: Measurable): () => void {
  anchors.set(id, m);
  return () => {
    if (anchors.get(id) === m) anchors.delete(id);
  };
}

/** The anchor's rect in window coordinates; null when nothing is registered or it has no size (not laid out). */
export function measureAnchor(id: string): Promise<Rect | null> {
  const m = anchors.get(id);
  if (!m) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      m.measureInWindow((x, y, width, height) => resolve(width > 0 || height > 0 ? { x, y, width, height } : null));
    } catch {
      resolve(null);
    }
  });
}

/** Wrap a view a guide may anchor to. `testID` is also set on the view (tests / automation keep working). */
export function GuideAnchor({ testID, children, style }: { testID: string; children?: ReactNode; style?: unknown }) {
  const ref = useRef<Measurable | null>(null);
  useEffect(() => (ref.current ? registerAnchor(testID, ref.current) : undefined), [testID]);
  return (
    <View ref={ref} testID={testID} collapsable={false} style={style}>
      {children}
    </View>
  );
}

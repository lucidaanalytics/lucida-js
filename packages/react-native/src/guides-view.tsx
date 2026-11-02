import { useContext, useEffect, useState } from "react";
import { Dimensions, Linking, Modal, Pressable, Text, View, useColorScheme } from "react-native";
import { measureAnchor } from "./guide-anchor.js";
import { bubbleOrigin, guideTokens, type GuideTokens, type Rect } from "./guide-theme.js";
import type { GuideButton, GuideView } from "./guides.js";
import { LucidaContext } from "./provider.js";

/**
 * Draws the current in-app guide step (plain text only). Mount once, as the LAST child of the app root (anchored
 * steps draw over the app from here); needs `guides.enabled`. Anchored steps (tooltip, hotspot, tour with native_id)
 * point at a `<GuideAnchor testID>`; a missing anchor shows the step as a modal.
 */
export function LucidaGuides() {
  const client = useContext(LucidaContext)?.client;
  const [v, setV] = useState<GuideView | null>(null);
  const dark = useColorScheme() === "dark";
  useEffect(() => {
    if (!client) return;
    client.guides.setOpener((u) => void Linking.openURL(u).catch(() => undefined));
    return client.guides.subscribe(setV);
  }, [client]);
  if (!client || !v) return null;
  const t = guideTokens(v.guide.appearance, dark);
  const act = (b: GuideButton | null): void => client.guides.act(b);
  if (v.anchor) return <AnchoredStep key={`${v.guide.id}:${v.step}`} v={v} t={t} act={act} missing={() => client.guides.targetMissing()} />;
  const step = v.guide.steps[v.step];
  const banner = v.guide.kind === "banner" || v.guide.kind === "announcement";
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => act(null)}>
      <View style={{ flex: 1, justifyContent: banner ? "flex-start" : "center", backgroundColor: "rgba(0,0,0,0.4)", padding: 16 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: t.background ?? "#fff", borderRadius: t.radius ?? 12, padding: 16 }}>
          <Body v={v} t={t} title={step?.title ?? null} />
          {v.guide.kind === "carousel" ? <Dots i={v.step} n={v.guide.steps.length} t={t} /> : null}
          <Buttons v={v} t={t} act={act} />
        </View>
      </View>
    </Modal>
  );
}

function Body({ v, t, title }: { v: GuideView; t: GuideTokens; title: string | null }) {
  const step = v.guide.steps[v.step];
  const font = t.font?.split(",")[0]?.trim().replace(/["']/g, "");
  return (
    <>
      {title ? <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: "600", color: t.text, fontFamily: font }}>{title}</Text> : null}
      {step?.body ? <Text style={{ marginTop: 8, color: t.text, fontFamily: font }}>{step.body}</Text> : null}
    </>
  );
}

function Buttons({ v, t, act }: { v: GuideView; t: GuideTokens; act: (b: GuideButton | null) => void }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 16 }}>
      {v.buttons.map((b, i) => (
        <Pressable key={i} accessibilityRole="button" accessibilityLabel={b.label} onPress={() => act(b)} style={{ padding: 8, marginLeft: 8 }}>
          <Text style={{ color: t.accent }}>{b.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Dots({ i, n, t }: { i: number; n: number; t: GuideTokens }) {
  return (
    <View accessibilityLabel={`Slide ${i + 1} of ${n}`} style={{ flexDirection: "row", justifyContent: "center", marginTop: 12 }}>
      {Array.from({ length: n }, (_, k) => (
        <View key={k} style={{ width: 8, height: 8, borderRadius: 4, marginHorizontal: 3, backgroundColor: k === i ? (t.accent ?? "#111") : "#ccc" }} />
      ))}
    </View>
  );
}

/**
 * Waits for the anchor (up to its wait), then follows it every 100 ms; a missing anchor is reported (the step then
 * re-renders as a modal). An anchor gone for 2 s (the screen changed) closes the step.
 */
function AnchoredStep({ v, t, act, missing }: { v: GuideView; t: GuideTokens; act: (b: GuideButton | null) => void; missing: () => void }) {
  const a = v.anchor!;
  const [rect, setRect] = useState<Rect | null>(null);
  const [open, setOpen] = useState(!a.hotspot);
  const [height, setHeight] = useState(120);
  useEffect(() => {
    let alive = true;
    let found = false;
    let goneSince = 0;
    const deadline = Date.now() + a.waitMs;
    const poll = async (): Promise<void> => {
      if (!alive) return;
      const r = await measureAnchor(a.nativeId);
      if (!alive) return;
      if (r) {
        found = true;
        goneSince = 0;
        setRect((p) => (p && p.x === r.x && p.y === r.y && p.width === r.width && p.height === r.height ? p : r));
      } else if (!found && Date.now() >= deadline) return missing();
      else if (found) {
        goneSince ||= Date.now();
        if (Date.now() - goneSince > 2000) return act(null);
      }
      setTimeout(() => void poll(), found ? 100 : 150);
    };
    void poll();
    return () => void (alive = false);
  }, [a.nativeId, a.waitMs]);
  if (!rect) return null;
  const win = Dimensions.get("window");
  const width = Math.min(300, win.width - 24);
  const at = bubbleOrigin(width, height, rect, { x: 0, y: 0, width: win.width, height: win.height }, a.placement);
  const step = v.guide.steps[v.step];
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      {a.hotspot ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step?.title ?? v.guide.name}
          onPress={() => setOpen(true)}
          style={{ position: "absolute", left: rect.x + rect.width - 8, top: rect.y - 8, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: "#fff", backgroundColor: t.accent ?? "#e5484d" }}
        />
      ) : null}
      {open ? (
        <View
          onLayout={(e: { nativeEvent: { layout: { height: number } } }) => setHeight(e.nativeEvent.layout.height)}
          style={{ position: "absolute", left: at.x, top: at.y, width, backgroundColor: t.background ?? "#fff", borderRadius: t.radius ?? 10, padding: 14, elevation: 6, shadowOpacity: 0.25, shadowRadius: 8 }}
        >
          <Body v={v} t={t} title={step?.title ?? (v.step === 0 ? v.guide.name : null)} />
          <Buttons v={v} t={t} act={act} />
        </View>
      ) : null}
    </View>
  );
}

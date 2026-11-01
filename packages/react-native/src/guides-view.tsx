import { useContext, useEffect, useState } from "react";
import { Linking, Modal, Pressable, Text, View } from "react-native";
import type { GuideView } from "./guides.js";
import { LucidaContext } from "./provider.js";

/** Draws the current in-app guide step (plain text only). Mount once, near the app root; needs `guides.enabled`. */
export function LucidaGuides() {
  const client = useContext(LucidaContext)?.client;
  const [v, setV] = useState<GuideView | null>(null);
  useEffect(() => {
    if (!client) return;
    client.guides.setOpener((u) => void Linking.openURL(u).catch(() => undefined));
    return client.guides.subscribe(setV);
  }, [client]);
  if (!client || !v) return null;
  const step = v.guide.steps[v.step];
  const banner = v.guide.kind === "banner" || v.guide.kind === "announcement";
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => client.guides.act(null)}>
      <View style={{ flex: 1, justifyContent: banner ? "flex-start" : "center", backgroundColor: "rgba(0,0,0,0.4)", padding: 16 }}>
        <View accessibilityViewIsModal style={{ backgroundColor: "#fff", borderRadius: 12, padding: 16 }}>
          {step?.title ? <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: "600" }}>{step.title}</Text> : null}
          {step?.body ? <Text style={{ marginTop: 8 }}>{step.body}</Text> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 16 }}>
            {v.buttons.map((b, i) => (
              <Pressable key={i} accessibilityRole="button" accessibilityLabel={b.label} onPress={() => client.guides.act(b)} style={{ padding: 8, marginLeft: 8 }}>
                <Text>{b.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

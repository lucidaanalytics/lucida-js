import { useEffect, useState } from "react";
import { NativeModules, Text, View } from "react-native";
import { createClient } from "@lucida-analytics/react-native";
// Written by the workflow before bundling: { "key": "<lc_pk_...>" } or { "key": "" } when the CI secret is absent.
import ci from "./lucida-ci.json";

// console.error: React Native release builds drop console.log on iOS; errors reach logcat and the unified log.
const say = (m: string) => console.error(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [n, setN] = useState(0);

  useEffect(() => {
    say(NativeModules.LucidaReplay ? "LUCIDA_NATIVE_OK" : "LUCIDA_NATIVE_MISSING");
    if (!ci.key) return;
    void (async () => {
      let sid = "";
      const client = await createClient(ci.key, {
        apiHost: "https://capture.lucidace.com",
        replay: { enabled: true, module: NativeModules.LucidaReplay, snapshotIntervalMs: 1000 },
        beforeSend: [
          (e) => {
            sid = String((e.properties as Record<string, unknown>).$session_id ?? sid);
            return e;
          },
        ],
      });
      client.optIn();
      client.screen("CiHome");
      for (let i = 1; i <= 10; i++) {
        setN(i); // each second changes the view tree, so every snapshot differs
        await sleep(1000);
      }
      await sleep(2000); // let the last snapshot upload
      await client.flush();
      await sleep(2000);
      say(`LUCIDA_SESSION ${sid}`);
    })();
  }, []);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: n % 2 ? "#fff" : "#def" }}>
      {Array.from({ length: n + 1 }, (_, i) => (
        <Text key={i}>{`frame ${n} row ${i}`}</Text>
      ))}
    </View>
  );
}

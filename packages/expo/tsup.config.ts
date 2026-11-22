import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", router: "src/router.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  external: ["react", "react-native", "expo-constants", "expo-application", /^@lucida-analytics\/react-native/],
});

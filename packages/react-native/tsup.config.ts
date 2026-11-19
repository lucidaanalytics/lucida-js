import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    ui: "src/ui.ts",
    "expo-router": "src/expo-router.ts",
    "storage/expo-file-system": "src/storage/expo-file-system.ts",
    "storage/expo-secure-store": "src/storage/expo-secure-store.ts",
    "storage/mmkv": "src/storage/mmkv.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "es2022",
  external: ["react", "react/jsx-runtime", "react-native", "expo-router", "expo-file-system", "expo-secure-store", "react-native-mmkv"],
});

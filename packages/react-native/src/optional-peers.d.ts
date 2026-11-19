// Optional peers imported only from subpath entries; the app supplies the real modules.
declare module "expo-router" {
  export function useSegments(): string[];
}
declare module "expo-file-system" {}
declare module "expo-secure-store" {
  export function getItemAsync(key: string): Promise<string | null>;
  export function setItemAsync(key: string, value: string): Promise<void>;
  export function deleteItemAsync(key: string): Promise<void>;
}
declare module "react-native-mmkv" {
  export const MMKV: unknown;
}

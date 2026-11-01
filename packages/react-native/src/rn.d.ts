// The slice of react-native that <LucidaGuides /> uses; the app supplies the real module (react-native is not a dependency of this package).
declare module "react-native" {
  import type { ComponentType, ReactNode } from "react";
  type Props = { children?: ReactNode; style?: unknown; [k: string]: unknown };
  export const Modal: ComponentType<Props>;
  export const Text: ComponentType<Props>;
  export const View: ComponentType<Props>;
  export const Pressable: ComponentType<Props>;
  export const Platform: { OS: string };
  export const Linking: { openURL(url: string): Promise<unknown> };
}

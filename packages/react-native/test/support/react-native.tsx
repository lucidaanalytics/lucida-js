// DOM stand-in for react-native (not installed here); vitest aliases "react-native" to this file.
import type { ReactNode } from "react";

type P = { children?: ReactNode; onPress?(): void; accessibilityLabel?: string; testID?: string; onTouchEnd?(e: { nativeEvent: { pageX: number; pageY: number } }): void };
export const Platform = { OS: "ios" };
export const Dimensions = { get: () => ({ width: 400, height: 800 }) };
export const useColorScheme = (): "light" | "dark" | null => null;
export const opened: string[] = [];
export const Linking = { openURL: async (u: string) => void opened.push(u) };
export const Modal = ({ children }: P) => <div id="modal">{children}</div>;
export const View = ({ children, testID, onTouchEnd }: P) => (
  <div data-testid={testID} onClick={(e) => onTouchEnd?.({ nativeEvent: { pageX: e.clientX, pageY: e.clientY } })}>{children}</div>
);
export const Text = ({ children }: P) => <span>{children}</span>;
export const Pressable = ({ children, onPress, accessibilityLabel }: P) => (
  <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>
);

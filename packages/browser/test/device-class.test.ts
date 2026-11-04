import { expect, it } from "vitest";
import { deviceClass } from "../src/flags/request-props.js";

const nav = (userAgent: string, extra: object = {}) => ({ userAgent, ...extra }) as Navigator;

it("classifies from the user agent and client hints, not the window width", () => {
  expect(deviceClass(1400, nav("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148"))).toBe("Mobile");
  expect(deviceClass(1400, nav("Mozilla/5.0 (iPad; CPU OS 17_0) Safari"))).toBe("Tablet");
  expect(deviceClass(300, nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", { maxTouchPoints: 5 }))).toBe("Tablet");
  expect(deviceClass(500, nav("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari"))).toBe("Mobile");
  expect(deviceClass(500, nav("Mozilla/5.0 (Linux; Android 14; SM-X900) Safari"))).toBe("Tablet");
  expect(deviceClass(500, nav("Mozilla/5.0 (Windows NT 10.0; Win64)"))).toBe("Desktop"); // narrow desktop window
  expect(deviceClass(1400, nav("custom", { userAgentData: { mobile: true } }))).toBe("Mobile");
  expect(deviceClass(800, nav("custom"))).toBe("Tablet");
});

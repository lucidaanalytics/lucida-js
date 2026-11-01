import { describe, expect, it } from "vitest";
import { cleanHeader, requestContext } from "../src/index.js";

const req = (h: Record<string, string>, extra: object = {}) => ({
  header: (n: string) => h[n.toLowerCase()],
  ...extra,
});

describe("cleanHeader", () => {
  it("strips control chars, trims, caps at 1000, empty -> undefined", () => {
    expect(cleanHeader("  a\u0000b\r\n ")).toBe("ab");
    expect(cleanHeader("x".repeat(1500))).toHaveLength(1000);
    expect(cleanHeader("  \t ")).toBeUndefined();
    expect(cleanHeader(null)).toBeUndefined();
  });
});

describe("requestContext", () => {
  it("reads tracing headers case-insensitively and builds request props", () => {
    const c = requestContext(
      req({ "x-lucida-distinct-id": " u1 ", "x-lucida-session-id": "s1", "user-agent": "UA/1", "x-forwarded-for": "9.9.9.9, 1.1.1.1" }, {
        url: "https://app.test/a/b?x=1",
        method: "post",
        remoteAddr: "10.0.0.1",
      }),
    );
    expect(c.distinctId).toBe("u1");
    expect(c.sessionId).toBe("s1");
    expect(c.props).toEqual({
      $current_url: "https://app.test/a/b?x=1",
      $request_path: "/a/b",
      $request_method: "POST",
      $user_agent: "UA/1",
      $ip: "10.0.0.1",
      $session_id: "s1",
    });
  });

  it("uses the first X-Forwarded-For hop only with trustProxy", () => {
    const r = req({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" }, { remoteAddr: "10.0.0.1" });
    expect(requestContext(r, { trustProxy: true }).props.$ip).toBe("9.9.9.9");
    expect(requestContext(r).props.$ip).toBe("10.0.0.1");
  });

  it("omits what is unknown", () => {
    expect(requestContext(req({}))).toEqual({ props: {} });
  });
});

import { describe, expect, it } from "vitest";
import { Lucida, withContext } from "../src/index.js";

const mk = (captureText?: boolean) => new Lucida("lc_pk_x", { testMode: { fixture: [] }, ...(captureText ? { ai: { captureText } } : {}) });
const ai = (l: Lucida) => l.captured.filter((e) => e.event.startsWith("$ai_"));

describe("lucida.ai", () => {
  it("captures a conversation for the given distinct id, text off by default", async () => {
    const l = mk();
    const c = l.ai.startConversation({ distinctId: "u1", agentName: "support", useCase: "refunds", traceId: "bad" });
    expect(c.message("user", "Thanks, that worked")).toBe(true);
    expect(c.message("assistant", "Glad to help")).toBe(true);
    expect(c.feedback({ kind: "rating", value: 5, comment: "great" })).toBe(true);
    c.end();
    expect(c.outcome("resolved", "refund issued")).toBe(true);
    const evs = ai(l);
    expect(evs.map((e) => e.event)).toEqual(["$ai_conversation_started", "$ai_message", "$ai_message", "$ai_feedback", "$ai_conversation_ended", "$ai_outcome"]);
    for (const e of evs) {
      expect(e.distinct_id).toBe("u1");
      expect(e.properties).toMatchObject({ $ai_conversation_id: c.id, $ai_agent_name: "support", $ai_use_case: "refunds" });
      expect(e.properties.$ai_trace_id).toBeUndefined();
      expect(e.properties.$ai_text).toBeUndefined();
      expect(e.properties.$ai_feedback_comment).toBeUndefined();
    }
    expect(evs[1]!.properties).toMatchObject({ $ai_role: "user", $ai_message_index: 0, $ai_sentiment: 1, $ai_text_length: 19 });
    expect(evs[3]!.properties).toMatchObject({ $ai_feedback_kind: "rating", $ai_feedback_value: 5 });
    expect(evs[5]!.properties).toMatchObject({ $ai_outcome: "resolved", $ai_resolution: "refund issued" });
    await l.shutdown();
  });

  it("captureText sends redacted text; the distinct id can come from withContext", async () => {
    const l = mk(true);
    withContext({ distinctId: "ctx-user" }, () => {
      l.ai.startConversation({ conversationId: "conv-1" }).message("user", "card 4242 4242 4242 4242 please");
    });
    const m = ai(l).find((e) => e.event === "$ai_message");
    expect(m).toMatchObject({ distinct_id: "ctx-user", properties: { $ai_conversation_id: "conv-1", $ai_text: "card **** **** **** **** please", $ai_text_redacted: true } });
    await l.shutdown();
  });
});

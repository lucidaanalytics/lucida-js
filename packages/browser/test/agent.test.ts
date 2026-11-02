import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "../src/index.js";
import { startWith } from "./helpers.js";

let live: Client | undefined;
afterEach(async () => {
  await live?.shutdown();
  live = undefined;
});

describe("client.ai", () => {
  it("captures a conversation through the normal capture path, text off by default", async () => {
    const { client, t } = startWith([]);
    live = client;
    const c = client.ai.startConversation({ agentName: "help-bot", agentVersion: "2", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" });
    c.message("user", "This is wrong, mail me at jo.e@ex.com");
    c.message("assistant", "Sorry!");
    c.feedback({ kind: "thumbs", value: -1, comment: "nope" });
    c.end("unresolved");
    await client.flush();
    const evs = t.events().filter((e) => e.event.startsWith("$ai_"));
    expect(evs.map((e) => e.event)).toEqual(["$ai_conversation_started", "$ai_message", "$ai_message", "$ai_feedback", "$ai_conversation_ended"]);
    for (const e of evs) {
      expect(e.properties).toMatchObject({ $ai_conversation_id: c.id, $ai_agent_name: "help-bot", $ai_agent_version: "2", $ai_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736" });
      expect(e.properties.$ai_text).toBeUndefined();
      expect(e.properties.$ai_feedback_comment).toBeUndefined();
      expect(e.distinct_id).toBe(client.distinctId);
    }
    expect(evs[1]!.properties).toMatchObject({ $ai_role: "user", $ai_message_index: 0, $ai_sentiment: -1 });
    expect(evs[1]!.properties.$ai_text_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(evs[2]!.properties.$ai_message_index).toBe(1);
    expect(evs[4]!.properties.$ai_outcome).toBe("unresolved");
  });

  it("captureText sends redacted text", async () => {
    const { client, t } = startWith([], { ai: { captureText: true } });
    live = client;
    client.ai.startConversation().message("user", "mail me at jo.e@ex.com");
    await client.flush();
    const m = t.events().find((e) => e.event === "$ai_message");
    expect(m?.properties).toMatchObject({ $ai_text: "mail me at ***********", $ai_text_redacted: true });
  });

  it("sends nothing after opt-out", async () => {
    const { client, t } = startWith([]);
    live = client;
    client.optOut();
    client.ai.startConversation().message("user", "hello there");
    await client.flush();
    expect(t.events().filter((e) => e.event.startsWith("$ai_"))).toEqual([]);
  });
});

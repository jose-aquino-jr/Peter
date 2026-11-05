import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../core/messages";
import { ConversationContext, DEFAULT_MAX_MESSAGES } from "./conversation-context";

function message(index: number): ConversationMessage {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    text: `mensagem ${index}`,
    timestamp: index,
  };
}

describe("ConversationContext", () => {
  it("keeps only the most recent messages when a custom limit is reached", () => {
    const context = new ConversationContext(4);
    for (let index = 1; index <= 6; index += 1) {
      context.add(message(index));
    }

    expect(context.getMessages().map((item) => item.text)).toEqual([
      "mensagem 3",
      "mensagem 4",
      "mensagem 5",
      "mensagem 6",
    ]);
  });

  it("bounds the default history during a long session", () => {
    const context = new ConversationContext();
    for (let index = 1; index <= DEFAULT_MAX_MESSAGES + 10; index += 1) {
      context.add(message(index));
    }

    const messages = context.getMessages();
    expect(messages).toHaveLength(DEFAULT_MAX_MESSAGES);
    expect(messages[0]?.text).toBe("mensagem 11");
    expect(messages.at(-1)?.text).toBe(
      `mensagem ${DEFAULT_MAX_MESSAGES + 10}`,
    );
  });

  it("rejects an invalid limit instead of silently disabling the bound", () => {
    expect(() => new ConversationContext(0)).toThrow(
      "O limite do contexto deve ser um inteiro positivo.",
    );
  });
});

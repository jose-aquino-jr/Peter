import type { AssistantInput } from "../core/messages";
import type { ConversationMessage } from "../core/messages";
import type { LanguageModel, LanguageModelReply } from "./language-model";
import { RuleEngine } from "./rule-engine";

/** Deterministic offline provider. It is used only after the configured primary provider fails. */
export class FallbackRuleProvider implements LanguageModel {
  constructor(private readonly rules = new RuleEngine()) {}

  async generateResponse(
    input: AssistantInput,
    _context: readonly ConversationMessage[],
  ): Promise<LanguageModelReply> {
    const matched = this.rules.resolve(input);
    if (matched) return matched;
    const text = input.type === "sign" ? input.recognition.gloss : input.text;
    return {
      text: `Entendi: “${text.trim()}”. Ainda estou aprendendo, mas posso conversar com você.`,
      source: "rules",
      intent: "conversation",
      emotion: "neutral",
      gesture: "listen",
    };
  }
}

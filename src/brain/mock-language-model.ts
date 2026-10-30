import { logger } from "../core/logger";
import type { AssistantInput } from "../core/messages";
import type { ConversationMessage } from "../core/messages";
import type { LanguageModel, LanguageModelReply } from "./language-model";

export class MockLanguageModel implements LanguageModel {
  async generateResponse(
    input: AssistantInput,
    context: readonly ConversationMessage[],
  ): Promise<LanguageModelReply> {
    logger.debug("brain", "Generating deterministic mock response", {
      previousMessages: context.length,
    });
    const text =
      input.type === "sign"
        ? input.recognition.gloss === "OBRIGADO"
          ? "De nada! Estou aqui para ajudar."
          : `Entendi o sinal “${input.recognition.gloss}”.`
        : `Recebi sua mensagem: “${input.text}”.`;

    return {
      text,
      source: "mock",
      intent: input.type === "sign" && input.recognition.gloss === "OBRIGADO"
        ? "acknowledge"
        : "conversation",
      emotion: "happy",
      gesture: input.type === "sign" ? "wave" : "nod",
    };
  }
}

import type { AssistantInput, AssistantIntent, Emotion, Gesture, ResponseSource } from "../core/messages";
import type { ConversationMessage } from "../core/messages";

export interface LanguageModelReply {
  readonly text: string;
  readonly source: ResponseSource;
  readonly intent: AssistantIntent;
  readonly emotion: Emotion;
  readonly gesture: Gesture;
}

export interface LanguageModel {
  readonly modelName?: string;
  checkAvailability?(): Promise<LanguageModelAvailability>;
  generateResponse(
    input: AssistantInput,
    context: readonly ConversationMessage[],
  ): Promise<LanguageModelReply>;
}

export interface LanguageModelAvailability {
  readonly status: "available" | "unavailable" | "model-missing";
  readonly model: string;
  readonly message: string;
}

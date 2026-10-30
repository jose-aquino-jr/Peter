import type { EventBus } from "../core/event-bus";
import type { AssistantInput, AssistantResponse, ConversationMessage } from "../core/messages";
import { logger } from "../core/logger";
import { ConversationContext } from "./conversation-context";
import type { BrainEngine } from "./brain-engine";
import type { LanguageModel } from "./language-model";

export class MockBrainEngine implements BrainEngine {
  private readonly unsubscribers: Array<() => void> = [];
  private readonly context = new ConversationContext();

  constructor(
    private readonly events: EventBus,
    private readonly model: LanguageModel,
  ) {}

  start(): void {
    if (this.unsubscribers.length > 0) {
      return;
    }
    this.unsubscribers.push(
      this.events.on("vision.sign-recognized", ({ recognition }) => {
        void this.respond({
          type: "sign",
          timestamp: recognition.timestamp,
          recognition,
        });
      }),
      this.events.on("voice.transcription", ({ text, timestamp }) => {
        void this.respond({ type: "transcription", text, timestamp });
      }),
    );
    logger.info("brain", "Brain engine started");
  }

  stop(): void {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    logger.info("brain", "Brain engine stopped");
  }

  getConversation(): readonly ConversationMessage[] {
    return this.context.getMessages();
  }

  private async respond(input: AssistantInput): Promise<void> {
    const userText =
      input.type === "sign" ? input.recognition.gloss : input.text;
    this.context.add({
      id: `user-${input.timestamp}`,
      role: "user",
      text: userText,
      timestamp: input.timestamp,
    });

    let generated;
    try {
      generated = await this.model.generateResponse(input, this.context.getMessages());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha ao gerar resposta no Brain.";
      this.events.emit({ type: "core.error", source: "brain", message });
      logger.error("brain", "Language model failed", error);
      return;
    }

    const response: AssistantResponse = { ...generated, inReplyTo: input };
    this.context.add({
      id: `assistant-${input.timestamp}`,
      role: "assistant",
      text: response.text,
      timestamp: Date.now(),
    });
    this.events.emit({ type: "brain.response", response });
    logger.info("brain", "Response generated", response);
  }
}

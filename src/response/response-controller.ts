import type { AvatarEngine } from "../avatar/avatar-engine";
import type { EventBus } from "../core/event-bus";
import { logger } from "../core/logger";
import type { TextToSpeechEngine } from "../voice/text-to-speech-engine";

export class ResponseController {
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly events: EventBus,
    private readonly voice: TextToSpeechEngine,
    private readonly avatar: AvatarEngine,
  ) {}

  start(): void {
    if (this.unsubscribe) {
      return;
    }
    this.unsubscribe = this.events.on("brain.response", ({ response }) => {
      this.avatar.cancelLibrasSequence();
      this.avatar.setEmotion(response.emotion);
      this.events.emit({ type: "conversation.state", state: "responding", message: "Peter está respondendo..." });
      this.events.emit({ type: "response.ready", response });
      void this.voice.speak(response.text).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Falha ao reproduzir a resposta.";
        this.events.emit({ type: "core.error", source: "voice", message });
        logger.error("response-controller", "Voice output failed", error);
      });
    });
  }

  stop(): void {
    this.avatar.cancelLibrasSequence();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

}

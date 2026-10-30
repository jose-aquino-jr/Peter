import type { EventBus } from "../core/event-bus";
import { logger } from "../core/logger";
import type { VoiceEngine } from "./voice-engine";

export class MockVoiceEngine implements VoiceEngine {
  constructor(private readonly events: EventBus) {}

  start(): void {
    this.events.emit({
      type: "voice.status",
      status: "ready",
      message: "Voz mock disponível para testes.",
    });
  }

  stop(): void {
    this.events.emit({ type: "voice.status", status: "idle", message: "Voz de teste parada." });
  }

  async speak(text: string): Promise<void> {
    logger.info("voice", "Mock speech output", text);
    this.events.emit({
      type: "voice.status",
      status: "mock",
      message: `Resposta preparada para voz: “${text}”`,
    });
  }
}

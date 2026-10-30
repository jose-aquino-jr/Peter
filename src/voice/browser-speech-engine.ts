import type { EventBus } from "../core/event-bus";
import { logger } from "../core/logger";
import type { VoiceEngine } from "./voice-engine";

export class BrowserSpeechEngine implements VoiceEngine {
  private activeUtterance: SpeechSynthesisUtterance | undefined;

  constructor(private readonly events: EventBus) {}

  start(): void {
    if (!("speechSynthesis" in window)) {
      const message = "Este navegador não oferece síntese de voz.";
      this.events.emit({ type: "voice.status", status: "error", message });
      return;
    }
    this.events.emit({
      type: "voice.status",
      status: "ready",
      message: "Síntese de voz do navegador disponível.",
    });
  }

  stop(): void {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.activeUtterance = undefined;
    this.events.emit({ type: "voice.status", status: "idle", message: "Síntese de voz parada." });
  }

  speak(text: string): Promise<void> {
    if (!("speechSynthesis" in window)) {
      return Promise.reject(new Error("Este navegador não oferece síntese de voz."));
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    this.activeUtterance = utterance;
    this.events.emit({
      type: "voice.status",
      status: "speaking",
      message: "Peter está falando.",
    });
    return new Promise((resolve, reject) => {
      utterance.onend = () => {
        if (this.activeUtterance === utterance) {
          this.activeUtterance = undefined;
          this.events.emit({ type: "voice.status", status: "idle", message: "Síntese concluída." });
        }
        resolve();
      };
      utterance.onerror = (event) => {
        if (this.activeUtterance === utterance) {
          this.activeUtterance = undefined;
        }
        const message = `Síntese de voz falhou: ${event.error}.`;
        this.events.emit({ type: "voice.status", status: "error", message });
        logger.error("voice", message);
        reject(new Error(message));
      };
      window.speechSynthesis.speak(utterance);
    });
  }
}

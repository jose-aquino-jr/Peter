import type { EventBus } from "../core/event-bus";
import type { TranscriptionProvider } from "./speech-to-text-engine";

/** Orchestrates capture and transcript events without binding the UI to a speech vendor. */
export class SpeechInputService {
  private active = false;
  private failed = false;
  private hadFinalResult = false;

  constructor(private readonly events: EventBus, private readonly provider: TranscriptionProvider) {}

  get supported(): boolean {
    return this.provider.supported;
  }

  get listening(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.failed = false;
    this.hadFinalResult = false;
    this.events.emit({ type: "voice.transcription-status", status: "listening", message: "Ouvindo..." });
    try {
      await this.provider.start({
        onInterimResult: (text) => {
          this.events.emit({ type: "voice.transcription-interim", text });
          if (text) {
            this.events.emit({ type: "voice.transcription-status", status: "transcribing", message: "Transcrevendo..." });
          }
        },
        onFinalResult: (text) => {
          const transcript = text.trim();
          if (!transcript) return;
          this.hadFinalResult = true;
          this.events.emit({ type: "voice.transcription-interim", text: "" });
          this.events.emit({ type: "voice.transcription", text: transcript, timestamp: Date.now() });
        },
        onEnd: () => {
          this.active = false;
          this.events.emit({ type: "voice.microphone-status", enabled: false });
          if (!this.failed && !this.hadFinalResult) {
            this.events.emit({ type: "voice.transcription-interim", text: "" });
            this.events.emit({
              type: "voice.transcription-status",
              status: "idle",
              message: "Não ouvi fala. Toque no microfone para tentar novamente.",
            });
          }
        },
        onError: (error) => {
          if (error.message.startsWith("Não detectei fala")) {
            return;
          }
          this.failed = true;
          this.active = false;
          this.events.emit({ type: "voice.microphone-status", enabled: false, message: error.message });
          this.events.emit({ type: "voice.transcription-status", status: "error", message: error.message });
        },
      });
      if (this.active) this.events.emit({ type: "voice.microphone-status", enabled: true });
    } catch (error) {
      this.active = false;
      const message = error instanceof Error ? error.message : "Não foi possível iniciar a transcrição.";
      this.failed = true;
      this.events.emit({ type: "voice.microphone-status", enabled: false, message });
      this.events.emit({ type: "voice.transcription-status", status: "error", message });
    }
  }

  stop(): void {
    if (!this.active) return;
    this.provider.stop();
  }
}

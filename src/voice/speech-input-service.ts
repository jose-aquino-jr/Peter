import type { EventBus } from "../core/event-bus";
import type { TranscriptionProvider } from "./speech-to-text-engine";
import { NO_SPEECH_MESSAGE_PREFIX } from "./speech-to-text-engine";

/** Orchestrates capture and transcript events without binding the UI to a speech vendor. */
export class SpeechInputService {
  private active = false;
  /** True while provider.start() has not settled yet. */
  private starting = false;
  /** Set when stop() arrives while starting; delivered once the provider finished starting. */
  private stopRequested = false;
  private failed = false;
  private hadFinalResult = false;
  /** True after "voice.microphone-status" enabled=true was published for the current session. */
  private announcedActive = false;

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
    this.starting = true;
    this.stopRequested = false;
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
          if (this.announcedActive) {
            this.announcedActive = false;
            this.events.emit({ type: "voice.microphone-status", enabled: false });
          }
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
          // Silence/no speech is an expected capture outcome, not a failure; onEnd() handles it.
          if (error.message.startsWith(NO_SPEECH_MESSAGE_PREFIX)) {
            return;
          }
          this.failed = true;
          this.active = false;
          this.announcedActive = false;
          this.events.emit({ type: "voice.microphone-status", enabled: false, message: error.message });
          this.events.emit({ type: "voice.transcription-status", status: "error", message: error.message });
        },
      });
      this.starting = false;
      if (this.active && this.stopRequested) {
        // stop() was requested before the provider finished starting; deliver it now.
        this.stopRequested = false;
        this.provider.stop();
        return;
      }
      if (!this.active) return;
      this.announcedActive = true;
      this.events.emit({ type: "voice.microphone-status", enabled: true });
    } catch (error) {
      this.active = false;
      this.starting = false;
      this.stopRequested = false;
      this.announcedActive = false;
      const message = error instanceof Error ? error.message : "Não foi possível iniciar a transcrição.";
      this.failed = true;
      this.events.emit({ type: "voice.microphone-status", enabled: false, message });
      this.events.emit({ type: "voice.transcription-status", status: "error", message });
    }
  }

  stop(): void {
    if (!this.active) return;
    if (this.starting) {
      // The provider cannot stop what it has not started yet; finish the request at the end of start().
      this.stopRequested = true;
      return;
    }
    this.provider.stop();
  }
}

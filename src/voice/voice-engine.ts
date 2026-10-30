import type { TextToSpeechEngine } from "./text-to-speech-engine";

export interface VoiceEngine extends TextToSpeechEngine {
  start(): void;
  stop(): void;
}

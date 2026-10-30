export interface TextToSpeechEngine {
  speak(text: string): Promise<void>;
}

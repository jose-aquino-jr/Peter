export interface TranscriptionCallbacks {
  onInterimResult(text: string): void;
  onFinalResult(text: string): void;
  onEnd(): void;
  onError(error: Error): void;
}

/** Replaceable speech recognition provider; UI and Brain depend only on SpeechInputService. */
export interface TranscriptionProvider {
  readonly supported: boolean;
  start(callbacks: TranscriptionCallbacks): Promise<void>;
  stop(): void;
}

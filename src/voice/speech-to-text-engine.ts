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

/**
 * Shared wording that marks an empty capture as "no speech detected". Providers must start
 * error messages for silent/unrecognized audio with this prefix so SpeechInputService can
 * classify them as an expected outcome instead of a failure.
 */
export const NO_SPEECH_MESSAGE_PREFIX = "Não detectei fala";

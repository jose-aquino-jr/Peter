export const gestures = [
  "wave",
  "nod",
  "shake_head",
  "thinking",
  "point",
  "listen",
] as const;

export type Gesture = (typeof gestures)[number];
export type Emotion = "happy" | "sad" | "neutral" | "thinking";
export type AssistantIntent =
  | "acknowledge"
  | "greeting"
  | "help"
  | "conversation";
export type ResponseSource = "local-llm" | "api" | "rules" | "mock";

export type ConversationState =
  | "idle"
  | "listening"
  | "transcribing"
  | "processing"
  | "responding"
  | "error";

export interface SignRecognition {
  readonly sign: string;
  readonly gloss: string;
  readonly confidence: number;
  readonly timestamp: number;
}

export type AssistantInput =
  | {
      readonly type: "sign";
      readonly timestamp: number;
      readonly recognition: SignRecognition;
    }
  | {
      readonly type: "transcription";
      readonly timestamp: number;
      readonly text: string;
    };

export interface AssistantResponse {
  readonly text: string;
  readonly source: ResponseSource;
  readonly intent: AssistantIntent;
  readonly emotion: Emotion;
  readonly gesture: Gesture;
  readonly inReplyTo: AssistantInput;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly source?: ResponseSource;
  readonly timestamp: number;
}

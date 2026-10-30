import type { SignRecognitionDebugSnapshot } from "../vision/pipeline/debug";
import type { AssistantResponse, ConversationState, Emotion, Gesture, SignRecognition } from "./messages";

export type AvatarCommand =
  | { readonly type: "gesture"; readonly gesture: Gesture }
  | { readonly type: "emotion"; readonly emotion: Emotion }
  | { readonly type: "look-at"; readonly target: "camera" }
  | { readonly type: "stop-gesture" };

export type PeterEvent =
  | { readonly type: "vision.sign-recognized"; readonly recognition: SignRecognition }
  | {
      readonly type: "vision.camera-status";
      readonly status: "idle" | "requesting" | "ready" | "denied" | "error";
      readonly message?: string;
    }
  | {
      readonly type: "vision.recognition-debug";
      readonly snapshot: SignRecognitionDebugSnapshot;
    }
  | {
      readonly type: "voice.microphone-status";
      readonly enabled: boolean;
      readonly message?: string;
    }
  | { readonly type: "brain.response"; readonly response: AssistantResponse }
  | {
      readonly type: "brain.llm-status";
      readonly status: "checking" | "available" | "unavailable" | "model-missing";
      readonly model: string;
      readonly message: string;
    }
  | {
      readonly type: "voice.transcription";
      readonly text: string;
      readonly timestamp: number;
    }
  | { readonly type: "voice.transcription-interim"; readonly text: string }
  | {
      readonly type: "voice.transcription-status";
      readonly status: "idle" | "listening" | "transcribing" | "error";
      readonly message: string;
    }
  | { readonly type: "conversation.state"; readonly state: ConversationState; readonly message: string }
  | { readonly type: "response.ready"; readonly response: AssistantResponse }
  | {
      readonly type: "voice.status";
      readonly status: "mock" | "ready" | "speaking" | "idle" | "error";
      readonly message: string;
    }
  | {
      readonly type: "avatar.status";
      readonly status: "mock" | "vrm-ready" | "error";
      readonly message: string;
    }
  | { readonly type: "avatar.command"; readonly command: AvatarCommand }
  | { readonly type: "core.error"; readonly source: string; readonly message: string };

export type PeterEventType = PeterEvent["type"];
export type EventOfType<Type extends PeterEventType> = Extract<PeterEvent, { type: Type }>;

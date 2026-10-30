import type { Emotion, Gesture } from "../core/messages";
import type { SignTemplate } from "../vision/pipeline/sign-template-repository";

export interface AvatarEngine {
  start(): void;
  stop(): void;
  playGesture(gesture: Gesture): void;
  playLibrasSequence(templates: readonly SignTemplate[]): Promise<void>;
  cancelLibrasSequence(): void;
  setEmotion(emotion: Emotion): void;
  lookAt(target: "camera"): void;
  stopGesture(): void;
}

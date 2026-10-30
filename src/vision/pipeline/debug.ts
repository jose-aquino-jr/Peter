import type { LandmarkFrame, SignRecognitionCandidate } from "./contracts";

export interface SignRecognitionDebugSnapshot {
  readonly cameraReady: boolean;
  readonly landmarksReady: boolean;
  readonly handsDetected: number;
  readonly poseDetected: boolean;
  readonly faceDetected: boolean;
  readonly fps: number;
  readonly latencyMs: number;
  readonly bufferFrames: number;
  readonly matchStatus: "idle" | "match" | "no_match" | "calibrating";
  readonly detectedSign?: string;
  readonly confidence?: number;
  readonly bestCandidate?: SignRecognitionCandidate;
  readonly candidates: readonly SignRecognitionCandidate[];
  readonly templateCount: number;
  readonly extractorStatus: "idle" | "loading" | "ready" | "error";
  readonly extractorMessage?: string;
  readonly memoryMb?: number;
  readonly calibrationPhase?: "countdown" | "recording";
  readonly calibrationRemainingMs?: number;
  readonly selectedGloss?: string;
  readonly frame?: LandmarkFrame;
}

export function readHeapMemoryMb(): number | undefined {
  const performanceWithMemory = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  if (!performanceWithMemory.memory) {
    return undefined;
  }
  return Math.round(performanceWithMemory.memory.usedJSHeapSize / 1_048_576);
}

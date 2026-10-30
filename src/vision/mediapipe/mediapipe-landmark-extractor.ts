import { FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { peterConfig } from "../../core/config";
import { logger } from "../../core/logger";
import type { Landmark, LandmarkExtractor, LandmarkFrame } from "../pipeline/contracts";

type ExtractorStatus = "idle" | "loading" | "ready" | "error";

interface MediaPipePoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export class MediapipeLandmarkExtractor implements LandmarkExtractor<HTMLVideoElement> {
  private hands: HandLandmarker | undefined;
  private pose: PoseLandmarker | undefined;
  private lastTimestamp = -1;
  private status: ExtractorStatus = "idle";
  private message: string | undefined;
  private loading: Promise<void> | undefined;

  get extractorStatus(): ExtractorStatus {
    return this.status;
  }

  get extractorMessage(): string | undefined {
    return this.message;
  }

  async ensureReady(): Promise<void> {
    if (this.status === "ready") {
      return;
    }
    if (!this.loading) {
      this.loading = this.load();
    }
    await this.loading;
  }

  async extract(frame: HTMLVideoElement): Promise<LandmarkFrame> {
    await this.ensureReady();
    if (!this.hands || !this.pose) {
      throw new Error(this.message ?? "MediaPipe não está pronto.");
    }
    if (frame.readyState < 2) {
      return emptyFrame(performance.now());
    }

    let timestamp = performance.now();
    if (timestamp <= this.lastTimestamp) {
      timestamp = this.lastTimestamp + 1;
    }
    this.lastTimestamp = timestamp;

    const handResult = this.hands.detectForVideo(frame, timestamp);
    const poseResult = this.pose.detectForVideo(frame, timestamp);
    const body = (poseResult.landmarks[0] ?? []).map(toLandmark);
    const { leftHand, rightHand } = splitHands(
      handResult.landmarks,
      handResult.handedness,
      body,
    );
    const face = body.slice(0, 11);

    return {
      timestamp,
      leftHand,
      rightHand,
      body,
      face,
      hands: [leftHand, rightHand].filter((hand) => hand.length > 0),
    };
  }

  close(): void {
    this.hands?.close();
    this.pose?.close();
    this.hands = undefined;
    this.pose = undefined;
    this.status = "idle";
    this.loading = undefined;
    this.lastTimestamp = -1;
  }

  private async load(): Promise<void> {
    this.status = "loading";
    this.message = "Carregando MediaPipe…";
    try {
      const wasm = await FilesetResolver.forVisionTasks(peterConfig.vision.mediapipeWasmBase);
      this.hands = await this.createHands(wasm);
      this.pose = await this.createPose(wasm);
      this.status = "ready";
      this.message = undefined;
      logger.info("vision", "MediaPipe landmarker ready");
    } catch (error) {
      this.status = "error";
      this.message =
        error instanceof Error ? error.message : "Falha ao carregar o MediaPipe.";
      this.loading = undefined;
      logger.error("vision", "MediaPipe load failed", error);
      throw error;
    }
  }

  private async createHands(wasm: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
    try {
      return await HandLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: peterConfig.vision.handModel, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch {
      return HandLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: peterConfig.vision.handModel, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    }
  }

  private async createPose(wasm: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>) {
    try {
      return await PoseLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: peterConfig.vision.poseModel, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch {
      return PoseLandmarker.createFromOptions(wasm, {
        baseOptions: { modelAssetPath: peterConfig.vision.poseModel, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    }
  }
}

function toLandmark(point: MediaPipePoint): Landmark {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  };
}

function splitHands(
  landmarks: MediaPipePoint[][] | undefined,
  handedness: Array<Array<{ categoryName?: string; displayName?: string }>> | undefined,
  body: readonly Landmark[],
): { leftHand: Landmark[]; rightHand: Landmark[] } {
  const leftHand: Landmark[] = [];
  const rightHand: Landmark[] = [];
  const leftWrist = body[15];
  const rightWrist = body[16];

  (landmarks ?? []).forEach((hand, index) => {
    const mapped = hand.map(toLandmark);
    const label = (handedness?.[index]?.[0]?.categoryName ?? handedness?.[index]?.[0]?.displayName ?? "")
      .toLowerCase();
    const side = resolveHandSide(mapped[0], label, leftWrist, rightWrist, leftHand.length > 0);
    if (side === "left") {
      leftHand.push(...mapped);
    } else {
      rightHand.push(...mapped);
    }
  });
  return { leftHand, rightHand };
}

function resolveHandSide(
  wrist: Landmark | undefined,
  label: string,
  leftPoseWrist: Landmark | undefined,
  rightPoseWrist: Landmark | undefined,
  leftAlreadyTaken: boolean,
): "left" | "right" {
  if (wrist && leftPoseWrist && rightPoseWrist) {
    const toLeft = Math.hypot(wrist.x - leftPoseWrist.x, wrist.y - leftPoseWrist.y);
    const toRight = Math.hypot(wrist.x - rightPoseWrist.x, wrist.y - rightPoseWrist.y);
    if (Math.abs(toLeft - toRight) > 0.02) {
      return toLeft < toRight ? "left" : "right";
    }
  }
  if (label.includes("left")) {
    return "left";
  }
  if (label.includes("right")) {
    return "right";
  }
  return leftAlreadyTaken ? "right" : "left";
}

function emptyFrame(timestamp: number): LandmarkFrame {
  return {
    timestamp,
    hands: [],
    leftHand: [],
    rightHand: [],
    body: [],
    face: [],
  };
}

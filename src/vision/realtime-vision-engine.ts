import { peterConfig } from "../core/config";
import type { EventBus } from "../core/event-bus";
import { logger } from "../core/logger";
import type { SignRecognitionDebugSnapshot } from "./pipeline/debug";
import { readHeapMemoryMb } from "./pipeline/debug";
import type { LandmarkFrame, SignMatchResult } from "./pipeline/contracts";
import { OfflineAnimationTemplateRepository } from "./pipeline/offline-animation-template-repository";
import {
  canonicalSkeletonToLandmarkFrame,
  CanonicalSkeletonNormalizer,
  MediaPipeLandmarkMapper,
} from "./pipeline/canonical-skeleton";
import { MediapipeLandmarkExtractor } from "./mediapipe/mediapipe-landmark-extractor";
import { findMvpSign } from "./pipeline/mvp-signs";
import { RecognitionStabilizer } from "./pipeline/recognition-stabilizer";
import { DtwSignMatchingEngine } from "./pipeline/sign-matching-engine";
import type { SignTemplate, SignTemplateRepository } from "./pipeline/sign-template-repository";
import { SlidingWindowBuffer } from "./pipeline/temporal-buffer";
import type { VisionEngine } from "./vision-engine";

interface CalibrationSession {
  gloss: string;
  phase: "countdown" | "recording";
  endsAt: number;
  frames: LandmarkFrame[];
}

export class RealtimeVisionEngine implements VisionEngine {
  private video: HTMLVideoElement | undefined;
  private running = false;
  private loopHandle = 0;
  private lastProcessAt = 0;
  private lastMatchAt = 0;
  private lastDebugAt = 0;
  private lastDetected: { sign: string; confidence: number; at: number } | undefined;
  private fps = 0;
  private latencyMs = 0;
  private framesThisSecond = 0;
  private fpsWindowStart = 0;
  private lastRawFrame: LandmarkFrame | undefined;
  private lastMatch: SignMatchResult = { status: "no_match", candidates: [] };
  private calibration: CalibrationSession | undefined;
  private templates: SignTemplate[] = [];
  private busy = false;

  constructor(
    private readonly events: EventBus,
    private readonly repository: SignTemplateRepository = new OfflineAnimationTemplateRepository(),
    private readonly extractor = new MediapipeLandmarkExtractor(),
    private readonly mapper = new MediaPipeLandmarkMapper(),
    private readonly normalizer = new CanonicalSkeletonNormalizer(),
    private readonly matcher = new DtwSignMatchingEngine(),
    private readonly buffer = new SlidingWindowBuffer(peterConfig.vision.bufferDurationMs),
    private readonly stabilizer = new RecognitionStabilizer(),
  ) {}

  start(): void {
    this.running = true;
    void this.reloadTemplates();
    logger.info("vision", "Realtime recognition engine started");
  }

  stop(): void {
    this.running = false;
    this.detachVideo();
    this.extractor.close();
    logger.info("vision", "Realtime recognition engine stopped");
  }

  attachVideo(video: HTMLVideoElement): void {
    this.video = video;
    this.buffer.reset();
    this.stabilizer.reset();
    this.lastProcessAt = 0;
    this.scheduleLoop();
    void this.extractor.ensureReady().then(
      () => this.emitDebug(),
      () => this.emitDebug(),
    );
  }

  detachVideo(): void {
    this.video = undefined;
    if (this.loopHandle) {
      cancelAnimationFrame(this.loopHandle);
      this.loopHandle = 0;
    }
    this.buffer.reset();
    this.lastRawFrame = undefined;
    this.emitDebug();
  }

  async listTemplates(): Promise<readonly SignTemplate[]> {
    return this.templates;
  }

  async removeTemplate(id: string): Promise<void> {
    await this.repository.remove(id);
    await this.reloadTemplates();
    this.emitDebug();
  }

  startCalibration(gloss: string): void {
    this.calibration = {
      gloss,
      phase: "countdown",
      endsAt: performance.now() + peterConfig.vision.countdownMs,
      frames: [],
    };
    this.emitDebug();
  }

  cancelCalibration(): void {
    this.calibration = undefined;
    this.emitDebug();
  }

  private scheduleLoop(): void {
    const tick = (now: number) => {
      this.loopHandle = requestAnimationFrame(tick);
      void this.process(now);
    };
    this.loopHandle = requestAnimationFrame(tick);
  }

  private async process(now: number): Promise<void> {
    if (!this.running || this.busy || !this.video) {
      this.updateCalibrationClock(now);
      return;
    }
    const minInterval = 1000 / peterConfig.vision.processFps;
    if (now - this.lastProcessAt < minInterval) {
      this.updateCalibrationClock(now);
      return;
    }
    this.lastProcessAt = now;
    this.busy = true;
    const started = performance.now();
    try {
      const raw = await this.extractor.extract(this.video);
      this.lastRawFrame = raw;
      const skeleton = this.normalizer.normalize(this.mapper.map(raw));
      const normalized = canonicalSkeletonToLandmarkFrame(skeleton);
      const sequence = this.buffer.append(normalized);
      this.updateFps(now);
      this.updateCalibration(now, normalized);

      if (!this.calibration && now - this.lastMatchAt >= peterConfig.vision.matchEveryMs) {
        this.lastMatchAt = now;
        if (this.buffer.size >= peterConfig.vision.minBufferFrames) {
          this.lastMatch = this.matcher.match(sequence);
          const recognized = this.stabilizer.observe(this.lastMatch, Date.now());
          if (recognized) {
            this.lastDetected = {
              sign: recognized.sign,
              confidence: recognized.confidence,
              at: Date.now(),
            };
            this.events.emit({
              type: "vision.sign-recognized",
              recognition: {
                sign: recognized.sign,
                gloss: recognized.gloss,
                confidence: recognized.confidence,
                timestamp: Date.now(),
              },
            });
          }
        }
      }
    } catch (error) {
      logger.error("vision", "Frame processing failed", error);
    } finally {
      this.latencyMs = Math.round(performance.now() - started);
      this.busy = false;
      if (now - this.lastDebugAt >= peterConfig.vision.debugEveryMs) {
        this.lastDebugAt = now;
        this.emitDebug();
      }
    }
  }

  private updateCalibrationClock(now: number): void {
    if (!this.calibration) {
      return;
    }
    if (now - this.lastDebugAt >= peterConfig.vision.debugEveryMs) {
      this.lastDebugAt = now;
      this.emitDebug();
    }
    if (this.calibration.phase === "countdown" && now >= this.calibration.endsAt) {
      this.calibration.phase = "recording";
      this.calibration.endsAt = now + peterConfig.vision.calibrationDurationMs;
      this.calibration.frames = [];
    }
  }

  private updateCalibration(now: number, frame: LandmarkFrame): void {
    if (!this.calibration) {
      return;
    }
    if (this.calibration.phase === "countdown" && now >= this.calibration.endsAt) {
      this.calibration.phase = "recording";
      this.calibration.endsAt = now + peterConfig.vision.calibrationDurationMs;
      this.calibration.frames = [];
    }
    if (this.calibration.phase === "recording") {
      this.calibration.frames.push(frame);
      if (now >= this.calibration.endsAt) {
        void this.finishCalibration();
      }
    }
  }

  private async finishCalibration(): Promise<void> {
    const session = this.calibration;
    if (!session) {
      return;
    }
    this.calibration = undefined;
    const catalog = findMvpSign(session.gloss);
    const frames = session.frames.filter((frame) =>
      frame.leftHand.length > 0 || frame.rightHand.length > 0 || frame.body.length > 0,
    );
    if (frames.length < peterConfig.vision.minBufferFrames) {
      logger.error("vision", "Calibration discarded: too few landmark frames");
      this.emitDebug();
      return;
    }
    const duration = frames.length > 1
      ? (frames.at(-1)!.timestamp - frames[0].timestamp) / 1000
      : peterConfig.vision.calibrationDurationMs / 1000;
    const existing = this.templates.filter((template) => template.gloss === session.gloss).length;
    const template: SignTemplate = {
      id: `${catalog?.id ?? session.gloss.toLowerCase()}-${existing + 1}-${Date.now()}`,
      name: catalog?.name ?? session.gloss,
      gloss: session.gloss,
      landmarkSequence: frames,
      duration,
      relevantLandmarks: catalog?.relevantLandmarks ?? ["leftHand", "rightHand", "pose"],
      metadata: {
        source: "local-camera",
        recordedAt: new Date().toISOString(),
      },
    };
    try {
      await this.repository.save(template);
      await this.reloadTemplates();
      logger.info("vision", `Saved template ${template.id}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha ao salvar o template de Libras.";
      logger.error("vision", "Template save failed", error);
      this.events.emit({ type: "core.error", source: "vision", message });
    }
    this.emitDebug();
  }

  private async reloadTemplates(): Promise<void> {
    this.templates = [...(await this.repository.list())];
    this.matcher.setTemplates(this.templates);
  }

  private updateFps(now: number): void {
    if (!this.fpsWindowStart) {
      this.fpsWindowStart = now;
    }
    this.framesThisSecond += 1;
    if (now - this.fpsWindowStart >= 1000) {
      this.fps = this.framesThisSecond;
      this.framesThisSecond = 0;
      this.fpsWindowStart = now;
    }
  }

  private emitDebug(): void {
    const snapshot = this.snapshot();
    this.events.emit({ type: "vision.recognition-debug", snapshot });
  }

  snapshot(): SignRecognitionDebugSnapshot {
    const now = performance.now();
    const detectedFresh =
      this.lastDetected && Date.now() - this.lastDetected.at < peterConfig.vision.cooldownMs
        ? this.lastDetected
        : undefined;
    return {
      cameraReady: Boolean(this.video),
      landmarksReady: Boolean(
        this.lastRawFrame &&
          (this.lastRawFrame.body.length > 0 ||
            this.lastRawFrame.leftHand.length > 0 ||
            this.lastRawFrame.rightHand.length > 0),
      ),
      handsDetected:
        (this.lastRawFrame?.leftHand.length ? 1 : 0) + (this.lastRawFrame?.rightHand.length ? 1 : 0),
      poseDetected: Boolean(this.lastRawFrame && this.lastRawFrame.body.length > 0),
      faceDetected: Boolean(this.lastRawFrame && this.lastRawFrame.face.length > 0),
      fps: this.fps,
      latencyMs: this.latencyMs,
      bufferFrames: this.buffer.size,
      matchStatus: this.calibration
        ? "calibrating"
        : detectedFresh
          ? "match"
          : this.lastMatch.status,
      detectedSign: detectedFresh?.sign,
      confidence: detectedFresh?.confidence,
      bestCandidate: this.lastMatch.best ?? this.lastMatch.candidates[0],
      candidates: this.lastMatch.candidates,
      templateCount: this.templates.length,
      extractorStatus: this.extractor.extractorStatus,
      extractorMessage: this.extractor.extractorMessage,
      memoryMb: readHeapMemoryMb(),
      calibrationPhase: this.calibration?.phase,
      calibrationRemainingMs: this.calibration
        ? Math.max(0, Math.round(this.calibration.endsAt - now))
        : undefined,
      frame: this.lastRawFrame,
    };
  }
}

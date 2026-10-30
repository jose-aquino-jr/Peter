export interface Landmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility?: number;
}

export type LandmarkChannel = "pose" | "leftHand" | "rightHand" | "face";

export interface LandmarkFrame {
  readonly timestamp: number;
  readonly hands: readonly Landmark[][];
  readonly leftHand: readonly Landmark[];
  readonly rightHand: readonly Landmark[];
  readonly body: readonly Landmark[];
  readonly face: readonly Landmark[];
}

export interface VideoFrameProcessor<Frame> {
  process(frame: Frame): Promise<Frame>;
}

export interface LandmarkExtractor<Frame> {
  extract(frame: Frame): Promise<LandmarkFrame>;
}

export interface LandmarkNormalizer {
  normalize(frame: LandmarkFrame): LandmarkFrame;
}

export interface TemporalSequence {
  readonly frames: readonly LandmarkFrame[];
  readonly startedAt: number;
  readonly endedAt: number;
}

export interface TemporalSequenceBuilder {
  append(frame: LandmarkFrame): TemporalSequence;
  snapshot(): TemporalSequence;
  reset(): void;
  get size(): number;
}

export interface SignRecognitionCandidate {
  readonly sign: string;
  readonly gloss: string;
  readonly confidence: number;
  readonly templateId?: string;
  readonly handShapeConfidence?: number;
  readonly handTrajectoryConfidence?: number;
}

export interface SignMatchResult {
  readonly status: "match" | "no_match";
  readonly candidates: readonly SignRecognitionCandidate[];
  readonly best?: SignRecognitionCandidate;
}

export interface SignMatchingEngine {
  match(sequence: TemporalSequence): SignMatchResult;
}

export interface SignRecognitionStrategy {
  recognize(sequence: TemporalSequence): Promise<SignRecognitionCandidate | undefined>;
}

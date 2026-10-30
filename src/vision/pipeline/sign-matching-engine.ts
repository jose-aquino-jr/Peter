import { peterConfig } from "../../core/config";
import type {
  SignMatchResult,
  SignMatchingEngine,
  SignRecognitionCandidate,
  SignRecognitionStrategy,
  TemporalSequence,
} from "./contracts";
import { dtwSimilarity } from "./dtw";
import {
  motionEnergy,
  sequenceToDualFeatureVectors,
} from "./feature-vector";
import type { SignTemplate } from "./sign-template-repository";

export interface MatchFeatureWeights {
  readonly handShape: number;
  readonly handTrajectory: number;
}

export type MatchRejectionReason =
  | "no_templates"
  | "insufficient_sequence"
  | "motion_gate"
  | "below_threshold"
  | "insufficient_margin"
  | "matched";

export interface TemplateMatchDiagnostic {
  readonly templateId: string;
  readonly gloss: string;
  readonly handShapeScore: number;
  readonly handTrajectoryScore?: number;
  readonly combinedScore: number;
}

export interface MatchDiagnosticResult {
  readonly result: SignMatchResult;
  readonly motionEnergy: number;
  readonly motionGatePassed: boolean;
  readonly minConfidence: number;
  readonly minMotion: number;
  readonly rejectionReason: MatchRejectionReason;
  readonly templateScores: readonly TemplateMatchDiagnostic[];
}

const DEFAULT_FEATURE_WEIGHTS: MatchFeatureWeights = {
  handShape: 0.5,
  handTrajectory: 0.5,
};

export class DtwSignMatchingEngine implements SignMatchingEngine, SignRecognitionStrategy {
  private templates: readonly SignTemplate[] = [];

  constructor(
    private readonly minConfidence: number = peterConfig.vision.minConfidence,
    private readonly topK: number = peterConfig.vision.topK,
    private readonly minMotion: number = peterConfig.vision.minMotion,
    private readonly windowRatio: number = peterConfig.vision.dtwWindowRatio,
    private readonly maxFrames: number = peterConfig.vision.maxMatchFrames,
    private readonly minScoreMargin: number = peterConfig.vision.minScoreMargin,
    private readonly featureWeights: MatchFeatureWeights = DEFAULT_FEATURE_WEIGHTS,
  ) {
    if (
      featureWeights.handShape < 0 ||
      featureWeights.handTrajectory < 0 ||
      featureWeights.handShape + featureWeights.handTrajectory === 0
    ) {
      throw new Error("Os pesos das features DTW devem ser não negativos e ter soma positiva.");
    }
  }

  setTemplates(templates: readonly SignTemplate[]): void {
    this.templates = templates;
  }

  match(sequence: TemporalSequence): SignMatchResult {
    return this.diagnose(sequence).result;
  }

  diagnose(sequence: TemporalSequence): MatchDiagnosticResult {
    const energy = motionEnergy(sequence);
    const motionGatePassed = energy >= this.minMotion;
    if (this.templates.length === 0) {
      return this.emptyDiagnostic(energy, motionGatePassed, "no_templates");
    }
    if (sequence.frames.length < 2) {
      return this.emptyDiagnostic(energy, motionGatePassed, "insufficient_sequence");
    }

    const queryFeatures = sequenceToDualFeatureVectors(sequence, this.maxFrames);
    const bestByGloss = new Map<string, SignRecognitionCandidate>();
    const templateScores: TemplateMatchDiagnostic[] = [];

    for (const template of this.templates) {
      if (template.landmarkSequence.length < 2) {
        continue;
      }
      const reference = sequenceToDualFeatureVectors(
        {
          frames: template.landmarkSequence,
          startedAt: template.landmarkSequence[0]?.timestamp ?? 0,
          endedAt: template.landmarkSequence.at(-1)?.timestamp ?? 0,
        },
        this.maxFrames,
      );
      const handShapeScore = dtwSimilarity(
        queryFeatures.handShape,
        reference.handShape,
        this.windowRatio,
      );
      const handTrajectoryScore =
        queryFeatures.handTrajectory.length > 1 && reference.handTrajectory.length > 1
          ? dtwSimilarity(
              queryFeatures.handTrajectory,
              reference.handTrajectory,
              this.windowRatio,
            )
          : undefined;
      const combinedScore = combineFeatureScores(
        handShapeScore,
        handTrajectoryScore,
        this.featureWeights,
      );
      templateScores.push({
        templateId: template.id,
        gloss: template.gloss,
        handShapeScore,
        handTrajectoryScore,
        combinedScore,
      });

      const previous = bestByGloss.get(template.gloss);
      if (!previous || combinedScore > previous.confidence) {
        bestByGloss.set(template.gloss, {
          sign: template.name,
          gloss: template.gloss,
          confidence: combinedScore,
          templateId: template.id,
          handShapeConfidence: handShapeScore,
          handTrajectoryConfidence: handTrajectoryScore,
        });
      }
    }

    const candidates = [...bestByGloss.values()]
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, this.topK);
    const best = candidates[0];
    if (!motionGatePassed) {
      return {
        result: { status: "no_match", candidates: [] },
        motionEnergy: energy,
        motionGatePassed,
        minConfidence: this.minConfidence,
        minMotion: this.minMotion,
        rejectionReason: "motion_gate",
        templateScores,
      };
    }
    if (!best || best.confidence < this.minConfidence) {
      return {
        result: { status: "no_match", candidates },
        motionEnergy: energy,
        motionGatePassed,
        minConfidence: this.minConfidence,
        minMotion: this.minMotion,
        rejectionReason: "below_threshold",
        templateScores,
      };
    }
    const runnerUp = candidates[1];
    if (runnerUp && best.confidence - runnerUp.confidence < this.minScoreMargin) {
      return {
        result: { status: "no_match", candidates },
        motionEnergy: energy,
        motionGatePassed,
        minConfidence: this.minConfidence,
        minMotion: this.minMotion,
        rejectionReason: "insufficient_margin",
        templateScores,
      };
    }
    return {
      result: { status: "match", candidates, best },
      motionEnergy: energy,
      motionGatePassed,
      minConfidence: this.minConfidence,
      minMotion: this.minMotion,
      rejectionReason: "matched",
      templateScores,
    };
  }

  async recognize(sequence: TemporalSequence): Promise<SignRecognitionCandidate | undefined> {
    const result = this.match(sequence);
    return result.status === "match" ? result.best : undefined;
  }

  private emptyDiagnostic(
    energy: number,
    motionGatePassed: boolean,
    rejectionReason: "no_templates" | "insufficient_sequence",
  ): MatchDiagnosticResult {
    return {
      result: { status: "no_match", candidates: [] },
      motionEnergy: energy,
      motionGatePassed,
      minConfidence: this.minConfidence,
      minMotion: this.minMotion,
      rejectionReason,
      templateScores: [],
    };
  }
}

function combineFeatureScores(
  handShapeScore: number,
  handTrajectoryScore: number | undefined,
  weights: MatchFeatureWeights,
): number {
  const trajectoryWeight = handTrajectoryScore === undefined ? 0 : weights.handTrajectory;
  const totalWeight = weights.handShape + trajectoryWeight;
  return (
    handShapeScore * weights.handShape +
    (handTrajectoryScore ?? 0) * trajectoryWeight
  ) / totalWeight;
}

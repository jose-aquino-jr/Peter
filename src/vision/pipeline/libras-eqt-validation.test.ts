import { describe, expect, it } from "vitest";
import {
  canonicalSkeletonToLandmarkFrame,
  type CanonicalSkeletonFrame,
} from "./canonical-skeleton";
import type { TemporalSequence } from "./contracts";
import { dtwSimilarity } from "./dtw";
import {
  frameToHandShapeVector,
  frameToHandTrajectoryVector,
  motionEnergy,
  sequenceToDualFeatureVectors,
} from "./feature-vector";
import { OfflineAnimationTemplateRepository } from "./offline-animation-template-repository";
import {
  DtwSignMatchingEngine,
  type MatchFeatureWeights,
  type MatchRejectionReason,
  type TemplateMatchDiagnostic,
} from "./sign-matching-engine";
import type { SignTemplate } from "./sign-template-repository";

interface DatasetSample {
  readonly id: string;
  readonly gloss: string;
  readonly split: "validation" | "test";
  readonly informant: string;
  readonly sourceEntry: string;
  readonly duration: number;
  readonly sampleRate: number;
  readonly handCoverage: number;
  readonly shoulderCoverage: number;
  readonly frames: readonly CanonicalSkeletonFrame[];
}

interface EvaluationSplit {
  readonly positive: readonly DatasetSample[];
  readonly negative: readonly DatasetSample[];
}

interface DatasetEvaluationFixture {
  readonly sourceDataset: string;
  readonly sourceRecord: string;
  readonly sourceDoi: string;
  readonly sourceLicense: string;
  readonly attribution: string;
  readonly splitPolicy: Readonly<Record<string, string>>;
  readonly representation: string;
  readonly validation: EvaluationSplit;
  readonly test: EvaluationSplit;
  readonly extractionSummary: readonly Record<string, string | number>[];
}

interface ScoredTemplate {
  readonly template: SignTemplate;
  readonly handShapeScore: number;
  readonly handTrajectoryScore?: number;
}

interface ScoredSample {
  readonly sample: DatasetSample;
  readonly truth: "SIM" | "NO_MATCH";
  readonly motion: number;
  readonly templateScores: readonly ScoredTemplate[];
}

interface ExperimentalConfiguration {
  readonly threshold: number;
  readonly minMotion: number;
  readonly weights: MatchFeatureWeights;
  readonly metrics: ConfusionMatrix;
}

interface ConfusionMatrix {
  readonly truePositive: number;
  readonly falseNegative: number;
  readonly falsePositive: number;
  readonly trueNegative: number;
  readonly recognitionRate: number;
  readonly falsePositiveRate: number;
  readonly noMatchRate: number;
  readonly balancedAccuracy: number;
}

const fixtures = import.meta.glob<DatasetEvaluationFixture>(
  "./fixtures/libras-eqt-dual-evaluation.json",
  { eager: true, import: "default" },
);
const fixture = Object.values(fixtures)[0];
const MAX_FRAMES = 16;
const WINDOW_RATIO = 0.28;
const DEFAULT_THRESHOLD = 0.68;
const HISTORICAL_EXPERIMENTAL_THRESHOLD = 0.565;
const WEIGHTS_TO_VALIDATE = [0.25, 0.5, 0.75];
const GATES_TO_VALIDATE = [0, 0.005, 0.01, 0.015, 0.018, 0.02, 0.025, 0.03, 0.04];
const THRESHOLDS_TO_VALIDATE = Array.from({ length: 46 }, (_, index) =>
  Number((0.5 + index * 0.01).toFixed(2)),
);

function toSequence(sample: DatasetSample): TemporalSequence {
  const frames = sample.frames.map((frame) => canonicalSkeletonToLandmarkFrame(frame));
  return {
    frames,
    startedAt: frames[0]?.timestamp ?? 0,
    endedAt: frames.at(-1)?.timestamp ?? 0,
  };
}

function precomputeSample(
  sample: DatasetSample,
  templates: readonly SignTemplate[],
): ScoredSample {
  const sequence = toSequence(sample);
  const query = sequenceToDualFeatureVectors(sequence, MAX_FRAMES);
  const templateScores = templates.map((template): ScoredTemplate => {
    const reference = sequenceToDualFeatureVectors({
      frames: template.landmarkSequence,
      startedAt: template.landmarkSequence[0]?.timestamp ?? 0,
      endedAt: template.landmarkSequence.at(-1)?.timestamp ?? 0,
    }, MAX_FRAMES);
    return {
      template,
      handShapeScore: dtwSimilarity(query.handShape, reference.handShape, WINDOW_RATIO),
      handTrajectoryScore: query.handTrajectory.length > 1 && reference.handTrajectory.length > 1
        ? dtwSimilarity(query.handTrajectory, reference.handTrajectory, WINDOW_RATIO)
        : undefined,
    };
  });
  return {
    sample,
    truth: sample.gloss === "SIM" ? "SIM" : "NO_MATCH",
    motion: motionEnergy(sequence),
    templateScores,
  };
}

function combinedScore(
  score: ScoredTemplate,
  handShapeWeight: number,
): number {
  const trajectoryWeight = score.handTrajectoryScore === undefined ? 0 : 1 - handShapeWeight;
  const totalWeight = handShapeWeight + trajectoryWeight;
  return (
    score.handShapeScore * handShapeWeight +
    (score.handTrajectoryScore ?? 0) * trajectoryWeight
  ) / totalWeight;
}

function predict(
  score: ScoredSample,
  threshold: number,
  minMotion: number,
  handShapeWeight: number,
): "SIM" | "NO_MATCH" {
  if (score.motion < minMotion || score.templateScores.length === 0) {
    return "NO_MATCH";
  }
  const best = Math.max(...score.templateScores.map((item) =>
    combinedScore(item, handShapeWeight),
  ));
  return best >= threshold ? "SIM" : "NO_MATCH";
}

function confusionMatrix(
  samples: readonly ScoredSample[],
  threshold: number,
  minMotion: number,
  handShapeWeight: number,
): ConfusionMatrix {
  let truePositive = 0;
  let falseNegative = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  for (const sample of samples) {
    const prediction = predict(sample, threshold, minMotion, handShapeWeight);
    if (sample.truth === "SIM" && prediction === "SIM") {
      truePositive += 1;
    } else if (sample.truth === "SIM") {
      falseNegative += 1;
    } else if (prediction === "SIM") {
      falsePositive += 1;
    } else {
      trueNegative += 1;
    }
  }
  const positiveCount = truePositive + falseNegative;
  const negativeCount = falsePositive + trueNegative;
  const recognitionRate = positiveCount === 0 ? 0 : truePositive / positiveCount;
  const falsePositiveRate = negativeCount === 0 ? 0 : falsePositive / negativeCount;
  const noMatchCount = falseNegative + trueNegative;
  return {
    truePositive,
    falseNegative,
    falsePositive,
    trueNegative,
    recognitionRate,
    falsePositiveRate,
    noMatchRate: samples.length === 0 ? 0 : noMatchCount / samples.length,
    balancedAccuracy:
      ((positiveCount === 0 ? 0 : recognitionRate) +
        (negativeCount === 0 ? 0 : 1 - falsePositiveRate)) / 2,
  };
}

function tuneOnValidation(samples: readonly ScoredSample[]): ExperimentalConfiguration {
  const candidates: ExperimentalConfiguration[] = [];
  for (const handShapeWeight of WEIGHTS_TO_VALIDATE) {
    for (const minMotion of GATES_TO_VALIDATE) {
      for (const threshold of THRESHOLDS_TO_VALIDATE) {
        candidates.push({
          threshold,
          minMotion,
          weights: {
            handShape: handShapeWeight,
            handTrajectory: 1 - handShapeWeight,
          },
          metrics: confusionMatrix(samples, threshold, minMotion, handShapeWeight),
        });
      }
    }
  }
  candidates.sort((left, right) =>
    right.metrics.balancedAccuracy - left.metrics.balancedAccuracy ||
    (right.metrics.trueNegative / Math.max(1, right.metrics.trueNegative + right.metrics.falsePositive)) -
      (left.metrics.trueNegative / Math.max(1, left.metrics.trueNegative + left.metrics.falsePositive)) ||
    right.metrics.recognitionRate - left.metrics.recognitionRate ||
    right.threshold - left.threshold ||
    right.minMotion - left.minMotion,
  );
  const best = candidates[0];
  if (!best) {
    throw new Error("A validação não produziu configurações candidatas.");
  }
  return best;
}

function evaluateWithEngine(
  samples: readonly DatasetSample[],
  templates: readonly SignTemplate[],
  threshold: number,
  minMotion: number,
  weights: MatchFeatureWeights,
) {
  const engine = new DtwSignMatchingEngine(
    threshold,
    3,
    minMotion,
    WINDOW_RATIO,
    MAX_FRAMES,
    0.08,
    weights,
  );
  engine.setTemplates(templates);
  const results = samples.map((sample) => {
    const diagnostic = engine.diagnose(toSequence(sample));
    const best = diagnostic.templateScores.reduce<TemplateMatchDiagnostic | undefined>(
      (current, candidate) =>
        !current || candidate.combinedScore > current.combinedScore ? candidate : current,
      undefined,
    );
    return {
      sampleId: sample.id,
      gloss: sample.gloss,
      informant: sample.informant,
      sourceEntry: sample.sourceEntry,
      dtwScore: best?.combinedScore ?? 0,
      handShapeScore: best?.handShapeScore ?? 0,
      handTrajectoryScore: best?.handTrajectoryScore ?? null,
      motionEnergy: diagnostic.motionEnergy,
      motionGatePassed: diagnostic.motionGatePassed,
      rejectionReason: diagnostic.rejectionReason,
      candidate: diagnostic.result.best?.gloss ?? "NO_MATCH",
    };
  });
  return results;
}

function rejectionReasonCounts(
  samples: readonly DatasetSample[],
  templates: readonly SignTemplate[],
  threshold: number,
  minMotion: number,
  weights: MatchFeatureWeights,
): Record<MatchRejectionReason, number> {
  const engine = new DtwSignMatchingEngine(
    threshold,
    3,
    minMotion,
    WINDOW_RATIO,
    MAX_FRAMES,
    0.08,
    weights,
  );
  engine.setTemplates(templates);
  const counts: Record<MatchRejectionReason, number> = {
    no_templates: 0,
    insufficient_sequence: 0,
    motion_gate: 0,
    below_threshold: 0,
    insufficient_margin: 0,
    matched: 0,
  };
  for (const sample of samples) {
    counts[engine.diagnose(toSequence(sample)).rejectionReason] += 1;
  }
  return counts;
}

function validateFixture(templates: readonly SignTemplate[]): void {
  if (!fixture) {
    throw new Error("Fixture dual de avaliação LIBRAS-EQT-UECE não foi carregado.");
  }
  expect(fixture.sourceDataset).toBe("LIBRAS-EQT-UECE");
  expect(fixture.sourceLicense).toBe("CC BY-NC 4.0");
  expect(fixture.representation).toBe("hand-shape-trajectory-v1");
  expect(templates).toHaveLength(18);
  expect(templates.every((template) => template.gloss === "SIM")).toBe(true);
  expect(templates.every((template) =>
    template.metadata.featureRepresentation === "hand-shape-trajectory-v1" &&
    template.metadata.split === "train",
  )).toBe(true);
  expect(new Set(templates.map((template) => template.metadata.informant)))
    .toEqual(new Set(["INFORMANTE 1", "INFORMANTE 2", "INFORMANTE 3"]));
  expect(fixture.validation.positive).toHaveLength(6);
  expect(fixture.validation.negative).toHaveLength(18);
  expect(fixture.test.positive).toHaveLength(6);
  expect(fixture.test.negative).toHaveLength(18);
  expect(new Set(fixture.validation.positive.map((sample) => sample.informant)))
    .toEqual(new Set(["INFORMANTE 4"]));
  expect(new Set(fixture.test.positive.map((sample) => sample.informant)))
    .toEqual(new Set(["INFORMANTE 5"]));
  expect(new Set(fixture.validation.negative.map((sample) => sample.gloss))).toEqual(
    new Set(["CAIR", "LUZ", "JA"]),
  );
  expect(new Set(fixture.test.negative.map((sample) => sample.gloss))).toEqual(
    new Set(["CAIR", "LUZ", "JA"]),
  );
}

describe("LIBRAS-EQT-UECE RGB dual-feature validation", () => {
  it("tunes on validation, then reports held-out diagnostics without using test for selection", async () => {
    if (!fixture) {
      throw new Error("Fixture dual de avaliação LIBRAS-EQT-UECE não foi carregado.");
    }
    const templates = await new OfflineAnimationTemplateRepository().list();
    validateFixture(templates);

    const validationSamples = [
      ...fixture.validation.positive,
      ...fixture.validation.negative,
    ].map((sample) => precomputeSample(sample, templates));
    const selected = tuneOnValidation(validationSamples);

    const untouchedTestSamples = [
      ...fixture.test.positive,
      ...fixture.test.negative,
    ];
    const defaultWeights: MatchFeatureWeights = { handShape: 0.5, handTrajectory: 0.5 };
    const historicalWeights: MatchFeatureWeights = { handShape: 0.5, handTrajectory: 0.5 };
    const configurations = [
      {
        name: "default",
        threshold: DEFAULT_THRESHOLD,
        minMotion: 0.018,
        weights: defaultWeights,
      },
      {
        name: "historical-experimental",
        threshold: HISTORICAL_EXPERIMENTAL_THRESHOLD,
        minMotion: 0,
        weights: historicalWeights,
      },
      {
        name: "validation-selected",
        threshold: selected.threshold,
        minMotion: selected.minMotion,
        weights: selected.weights,
      },
    ];

    const report = {
      protocol: {
        train: "INFORMANTE 1-3",
        validation: "INFORMANTE 4",
        test: "INFORMANTE 5",
        tuningCandidates: {
          thresholds: THRESHOLDS_TO_VALIDATE,
          handShapeWeights: WEIGHTS_TO_VALIDATE,
          minMotionGates: GATES_TO_VALIDATE,
        },
        note: "O artigo diz que rótulos de informante são locais por item; eles não garantem identidade física disjunta entre diferentes sinais.",
      },
      validationSelected: selected,
      configurations: configurations.map((configuration) => {
        const testScores = untouchedTestSamples.map((sample) => ({
          ...sample,
          expected: sample.gloss === "SIM" ? "SIM" : "NO_MATCH",
        }));
        const diagnostics = evaluateWithEngine(
          testScores,
          templates,
          configuration.threshold,
          configuration.minMotion,
          configuration.weights,
        );
        const predictions = diagnostics.map((sample) => ({
          expected: sample.gloss === "SIM" ? "SIM" : "NO_MATCH",
          candidate: sample.candidate,
        }));
        const matrix = matrixFromPredictions(predictions);
        return {
          ...configuration,
          confusionMatrix: matrix,
          rejectionReasons: rejectionReasonCounts(
            testScores,
            templates,
            configuration.threshold,
            configuration.minMotion,
            configuration.weights,
          ),
          diagnostics,
        };
      }),
    };

    const validationMetrics = selected.metrics;
    expect(validationMetrics.truePositive + validationMetrics.falseNegative).toBe(6);
    expect(validationMetrics.falsePositive + validationMetrics.trueNegative).toBe(18);
    expect(report.configurations).toHaveLength(3);
    console.info(`LIBRAS-EQT_DUAL_REPORT=${JSON.stringify(report)}`);

    const sample = fixture.test.positive[0];
    const sequence = toSequence(sample);
    expect(sequence.frames.every((frame) =>
      frameToHandShapeVector(frame).length > 0 &&
      frameToHandTrajectoryVector(frame) !== undefined,
    )).toBe(true);
  });
});

function matrixFromPredictions(
  predictions: readonly { readonly expected: string; readonly candidate: string }[],
): ConfusionMatrix {
  let truePositive = 0;
  let falseNegative = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  for (const { expected, candidate } of predictions) {
    const predicted = candidate === "SIM" ? "SIM" : "NO_MATCH";
    if (expected === "SIM" && predicted === "SIM") {
      truePositive += 1;
    } else if (expected === "SIM") {
      falseNegative += 1;
    } else if (predicted === "SIM") {
      falsePositive += 1;
    } else {
      trueNegative += 1;
    }
  }
  const positives = truePositive + falseNegative;
  const negatives = falsePositive + trueNegative;
  const recognitionRate = positives === 0 ? 0 : truePositive / positives;
  const falsePositiveRate = negatives === 0 ? 0 : falsePositive / negatives;
  return {
    truePositive,
    falseNegative,
    falsePositive,
    trueNegative,
    recognitionRate,
    falsePositiveRate,
    noMatchRate: predictions.length === 0
      ? 0
      : (falseNegative + trueNegative) / predictions.length,
    balancedAccuracy:
      ((positives === 0 ? 0 : recognitionRate) +
        (negatives === 0 ? 0 : 1 - falsePositiveRate)) / 2,
  };
}

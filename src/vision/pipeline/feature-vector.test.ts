import { describe, expect, it } from "vitest";
import type { Landmark, LandmarkFrame, TemporalSequence } from "./contracts";
import {
  canonicalSkeletonToLandmarkFrame,
  CanonicalSkeletonNormalizer,
  MediaPipeLandmarkMapper,
} from "./canonical-skeleton";
import {
  frameToHandShapeVector,
  frameToHandTrajectoryVector,
  sequenceToDualFeatureVectors,
} from "./feature-vector";

function point(x: number, y: number, z = 0): Landmark {
  return { x, y, z, visibility: 1 };
}

function handAt(x: number, y: number, scale = 1): Landmark[] {
  return Array.from({ length: 21 }, (_, index) => {
    const finger = Math.floor(Math.max(index - 1, 0) / 4);
    const joint = index === 0 ? 0 : ((index - 1) % 4) + 1;
    const fingerOffset = finger * 0.08 * scale;
    return point(x + fingerOffset + joint * 0.015 * scale, y - joint * 0.04 * scale);
  });
}

function frame(timestamp: number, wristX: number, scale = 1): LandmarkFrame {
  const body = Array.from({ length: 33 }, () => point(0.5, 0.5));
  body[11] = point(0.35, 0.4);
  body[12] = point(0.65, 0.4);
  const rightHand = handAt(wristX, 0.65, scale);
  return {
    timestamp,
    body,
    face: [],
    leftHand: [],
    rightHand,
    hands: [rightHand],
  };
}

function sequence(frames: readonly LandmarkFrame[]): TemporalSequence {
  return {
    frames,
    startedAt: frames[0]?.timestamp ?? 0,
    endedAt: frames.at(-1)?.timestamp ?? 0,
  };
}

function normalize(frame: LandmarkFrame): LandmarkFrame {
  const skeleton = new MediaPipeLandmarkMapper().map(frame);
  return canonicalSkeletonToLandmarkFrame(new CanonicalSkeletonNormalizer().normalize(skeleton));
}

function expectVectorsClose(left: readonly number[], right: readonly number[]): void {
  expect(left).toHaveLength(right.length);
  left.forEach((value, index) => expect(value).toBeCloseTo(right[index], 10));
}

describe("dual hand representation", () => {
  it("normalizes finger shape relative to the wrist and palm scale", () => {
    const original = normalize(frame(0, 0.6));
    const translatedAndScaled: LandmarkFrame = {
      ...frame(0, 0.6),
      body: frame(0, 0.6).body.map((item) => ({
        x: item.x * 1.8 + 0.1,
        y: item.y * 1.8 - 0.2,
        z: item.z * 1.8 + 0.3,
        visibility: item.visibility,
      })),
      rightHand: handAt(0.6 * 1.8 + 0.1, 0.65 * 1.8 - 0.2, 1.8),
      hands: [],
    };
    const transformed = normalize(translatedAndScaled);

    expectVectorsClose(
      frameToHandShapeVector(transformed),
      frameToHandShapeVector(original),
    );
  });

  it("preserves wrist movement relative to the shoulder frame", () => {
    const first = normalize(frame(0, 0.55));
    const second = normalize(frame(80, 0.75));

    expectVectorsClose(frameToHandShapeVector(first), frameToHandShapeVector(second));
    expect(frameToHandTrajectoryVector(first)).not.toEqual(frameToHandTrajectoryVector(second));

    const representations = sequenceToDualFeatureVectors(sequence([first, second]), 16);
    expectVectorsClose(representations.handShape[0], representations.handShape[1]);
    expect(representations.handTrajectory[0]).not.toEqual(representations.handTrajectory[1]);
  });

  it("does not fabricate trajectory when the shoulders are unavailable", () => {
    const frameWithoutPose = normalize({ ...frame(0, 0.6), body: [] });
    expect(frameToHandTrajectoryVector(frameWithoutPose)).toBeUndefined();
    expect(sequenceToDualFeatureVectors(sequence([frameWithoutPose, frameWithoutPose]))
      .handTrajectory).toHaveLength(0);
  });
});

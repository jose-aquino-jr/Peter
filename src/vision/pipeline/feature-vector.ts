import type { Landmark, LandmarkFrame, TemporalSequence } from "./contracts";

const HAND_POINT_COUNT = 21;
const WRIST_INDEX = 0;
const MIDDLE_MCP_INDEX = 9;
const MIN_PALM_SCALE = 0.015;
const MIN_SHOULDER_SCALE = 0.04;
const MIN_VISIBILITY = 0.35;
export const HAND_SHAPE_TRAJECTORY_REPRESENTATION = "hand-shape-trajectory-v1";

export interface DualFeatureVectors {
  readonly handShape: readonly (readonly number[])[];
  readonly handTrajectory: readonly (readonly number[])[];
}

export function frameToHandShapeVector(frame: LandmarkFrame): number[] {
  return [
    ...handShapeFeatures(frame.leftHand),
    ...handShapeFeatures(frame.rightHand),
  ];
}

export function frameToHandTrajectoryVector(frame: LandmarkFrame): number[] | undefined {
  const shoulders = shoulderReference(frame);
  if (!shoulders) {
    return undefined;
  }
  const { origin, scale } = shoulders;
  return [
    ...handTrajectoryFeatures(frame.leftHand, origin, scale),
    ...handTrajectoryFeatures(frame.rightHand, origin, scale),
  ];
}

export function sequenceToDualFeatureVectors(
  sequence: TemporalSequence,
  maxFrames = 16,
): DualFeatureVectors {
  const shape = sequence.frames.map(frameToHandShapeVector);
  const trajectory = sequence.frames.map(frameToHandTrajectoryVector);
  const completeTrajectory = trajectory.every((vector) => vector !== undefined)
    ? trajectory.filter((vector): vector is number[] => vector !== undefined)
    : [];
  return {
    handShape: resampleVectors(shape, maxFrames),
    handTrajectory: resampleVectors(completeTrajectory, maxFrames),
  };
}

export function resampleVectors(
  vectors: readonly (readonly number[])[],
  maxFrames: number,
): number[][] {
  if (vectors.length === 0 || maxFrames < 1) {
    return [];
  }
  if (vectors.length <= maxFrames) {
    return vectors.map((vector) => [...vector]);
  }
  const resampled: number[][] = [];
  const lastIndex = vectors.length - 1;
  for (let index = 0; index < maxFrames; index += 1) {
    const source = Math.round((index * lastIndex) / (maxFrames - 1));
    resampled.push([...vectors[source]]);
  }
  return resampled;
}

export function motionEnergy(sequence: TemporalSequence): number {
  if (sequence.frames.length < 2) {
    return 0;
  }
  let total = 0;
  let count = 0;
  for (let index = 1; index < sequence.frames.length; index += 1) {
    const previous = sequence.frames[index - 1];
    const current = sequence.frames[index];
    for (const [from, to] of [
      [previous.leftHand, current.leftHand],
      [previous.rightHand, current.rightHand],
      [bodyWrists(previous.body), bodyWrists(current.body)],
    ]) {
      const travel = landmarkTravel(from, to);
      total += travel.total;
      count += travel.count;
    }
  }
  return count === 0 ? 0 : total / count;
}

function handShapeFeatures(hand: readonly Landmark[]): number[] {
  const wrist = hand[WRIST_INDEX];
  const middleMcp = hand[MIDDLE_MCP_INDEX];
  const scale = wrist && middleMcp && isVisible(wrist) && isVisible(middleMcp)
    ? distance(wrist, middleMcp)
    : 0;
  if (scale < MIN_PALM_SCALE) {
    return Array.from({ length: HAND_POINT_COUNT * 4 }, () => 0);
  }
  return Array.from({ length: HAND_POINT_COUNT }, (_, index) => {
    const point = hand[index];
    if (!point || !isVisible(point)) {
      return [0, 0, 0, 0];
    }
    return [
      (point.x - wrist.x) / scale,
      (point.y - wrist.y) / scale,
      (point.z - wrist.z) / scale,
      1,
    ];
  }).flat();
}

function handTrajectoryFeatures(
  hand: readonly Landmark[],
  origin: Landmark,
  scale: number,
): number[] {
  const wrist = hand[WRIST_INDEX];
  if (!wrist || !isVisible(wrist)) {
    return [0, 0, 0, 0];
  }
  return [
    (wrist.x - origin.x) / scale,
    (wrist.y - origin.y) / scale,
    (wrist.z - origin.z) / scale,
    1,
  ];
}

function shoulderReference(
  frame: LandmarkFrame,
): { readonly origin: Landmark; readonly scale: number } | undefined {
  const [leftIndex, rightIndex] = frame.body.length === 13 ? [1, 2] : [11, 12];
  const left = frame.body[leftIndex];
  const right = frame.body[rightIndex];
  if (!left || !right || !isVisible(left) || !isVisible(right)) {
    return undefined;
  }
  const scale = distance(left, right);
  if (scale < MIN_SHOULDER_SCALE) {
    return undefined;
  }
  return {
    origin: {
      x: (left.x + right.x) / 2,
      y: (left.y + right.y) / 2,
      z: (left.z + right.z) / 2,
    },
    scale,
  };
}

function bodyWrists(body: readonly Landmark[]): readonly Landmark[] {
  return body.length === 13 ? body.slice(5, 7) : body.slice(15, 17);
}

function isVisible(point: Landmark): boolean {
  return (point.visibility ?? 1) >= MIN_VISIBILITY;
}

function distance(left: Landmark, right: Landmark): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function landmarkTravel(
  previous: readonly Landmark[],
  current: readonly Landmark[],
): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (let index = 0; index < Math.min(previous.length, current.length); index += 1) {
    const from = previous[index];
    const to = current[index];
    if (!from || !to || !isVisible(from) || !isVisible(to)) {
      continue;
    }
    total += distance(from, to);
    count += 1;
  }
  return { total, count };
}

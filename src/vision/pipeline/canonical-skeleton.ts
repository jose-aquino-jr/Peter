import type { Landmark, LandmarkFrame } from "./contracts";

export interface CanonicalPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly visibility?: number;
}

function handWristJoint(side: CanonicalSide): CanonicalJoint {
  return `${side}HandWrist`;
}

function handJoint(
  side: CanonicalSide,
  finger: CanonicalFinger,
  joint: FingerJointNumber,
): CanonicalJoint {
  return `${side}${finger}${joint}`;
}

const BODY_JOINTS = [
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
] as const;

type CanonicalSide = "left" | "right";
type CanonicalFinger = "Thumb" | "Index" | "Middle" | "Ring" | "Pinky";
type FingerJointNumber = 1 | 2 | 3 | 4;
export type CanonicalJoint =
  | (typeof BODY_JOINTS)[number]
  | `${CanonicalSide}HandWrist`
  | `${CanonicalSide}${CanonicalFinger}${FingerJointNumber}`;

const HAND_JOINT_NAMES = (["left", "right"] as const).flatMap((side) =>
  (["Thumb", "Index", "Middle", "Ring", "Pinky"] as const).flatMap((finger) =>
    ([1, 2, 3, 4] as const).map((joint) => handJoint(side, finger, joint)),
  ),
);

export const CANONICAL_JOINTS: readonly CanonicalJoint[] = [
  ...BODY_JOINTS,
  "leftHandWrist",
  "rightHandWrist",
  ...HAND_JOINT_NAMES,
];

export interface CanonicalSkeletonFrame {
  readonly timestamp: number;
  readonly joints: Partial<Record<CanonicalJoint, CanonicalPoint>>;
}

export interface CanonicalBoneSample {
  readonly name: string;
  readonly head: CanonicalPoint;
  readonly tail: CanonicalPoint;
}

export interface AnimationBoneMapping {
  readonly bone: string;
  readonly point: "head" | "tail";
}

export type AnimationBoneMap = Readonly<Partial<Record<CanonicalJoint, AnimationBoneMapping>>>;

const POSE_JOINTS: ReadonlyArray<readonly [CanonicalJoint, number]> = [
  ["head", 0],
  ["leftShoulder", 11],
  ["rightShoulder", 12],
  ["leftElbow", 13],
  ["rightElbow", 14],
  ["leftWrist", 15],
  ["rightWrist", 16],
  ["leftHip", 23],
  ["rightHip", 24],
  ["leftKnee", 25],
  ["rightKnee", 26],
  ["leftAnkle", 27],
  ["rightAnkle", 28],
];

const CANONICAL_BODY_ORDER: readonly CanonicalJoint[] = [
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftElbow",
  "rightElbow",
  "leftWrist",
  "rightWrist",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
];

const HAND_JOINTS = [
  ["Thumb", 1],
  ["Index", 5],
  ["Middle", 9],
  ["Ring", 13],
  ["Pinky", 17],
] as const;

export class MediaPipeLandmarkMapper {
  map(frame: LandmarkFrame): CanonicalSkeletonFrame {
    const joints: Partial<Record<CanonicalJoint, CanonicalPoint>> = {};
    for (const [joint, index] of POSE_JOINTS) {
      const landmark = frame.body[index];
      if (landmark && (landmark.visibility ?? 1) >= 0.35) {
        joints[joint] = cameraAxes(landmark);
      }
    }
    this.mapHand(frame.leftHand, "left", joints);
    this.mapHand(frame.rightHand, "right", joints);
    return { timestamp: frame.timestamp, joints };
  }

  private mapHand(
    points: readonly Landmark[],
    side: "left" | "right",
    joints: Partial<Record<CanonicalJoint, CanonicalPoint>>,
  ): void {
    const wrist = points[0];
    if (wrist) {
      joints[handWristJoint(side)] = cameraAxes(wrist);
    }
    for (const [finger, start] of HAND_JOINTS) {
      for (let offset = 0; offset < 4; offset += 1) {
        const point = points[start + offset];
        if (point) {
          joints[handJoint(side, finger, (offset + 1) as FingerJointNumber)] = cameraAxes(point);
        }
      }
    }
  }
}

export class AnimationSkeletonMapper {
  constructor(private readonly boneMap: AnimationBoneMap) {}

  map(
    samples: readonly CanonicalBoneSample[],
    timestamp: number,
  ): CanonicalSkeletonFrame {
    const byName = new Map(samples.map((sample) => [sample.name, sample]));
    const joints: Partial<Record<CanonicalJoint, CanonicalPoint>> = {};
    for (const [joint, mapping] of Object.entries(this.boneMap) as Array<
      [CanonicalJoint, AnimationBoneMapping | undefined]
    >) {
      if (!mapping) {
        continue;
      }
      const sample = byName.get(mapping.bone);
      const point = sample?.[mapping.point];
      if (point) {
        joints[joint] = { ...point, visibility: 1 };
      }
    }
    return { timestamp, joints };
  }
}

export class CanonicalSkeletonNormalizer {
  normalize(frame: CanonicalSkeletonFrame): CanonicalSkeletonFrame {
    const leftShoulder = frame.joints.leftShoulder;
    const rightShoulder = frame.joints.rightShoulder;
    let origin: CanonicalPoint;
    let scale: number;
    if (leftShoulder && rightShoulder) {
      origin = midpoint(leftShoulder, rightShoulder);
      scale = Math.max(distance(leftShoulder, rightShoulder), 0.04);
    } else {
      const fallback = normalizePointCloud(Object.values(frame.joints).filter(isPoint));
      origin = fallback.origin;
      scale = fallback.scale;
    }
    const joints: Partial<Record<CanonicalJoint, CanonicalPoint>> = {};
    for (const [joint, point] of Object.entries(frame.joints) as Array<
      [CanonicalJoint, CanonicalPoint | undefined]
    >) {
      if (point) {
        joints[joint] = {
          x: (point.x - origin.x) / scale,
          y: (point.y - origin.y) / scale,
          z: (point.z - origin.z) / scale,
          visibility: point.visibility,
        };
      }
    }
    return { timestamp: frame.timestamp, joints };
  }
}

export function normalizePointCloud(points: readonly CanonicalPoint[]): {
  readonly origin: CanonicalPoint;
  readonly scale: number;
} {
  const visiblePoints = points.filter((point) => (point.visibility ?? 1) >= 0.35);
  return {
    origin: boundsCenter(visiblePoints),
    scale: boundsScale(visiblePoints),
  };
}

export function canonicalSkeletonToLandmarkFrame(frame: CanonicalSkeletonFrame): LandmarkFrame {
  const body = CANONICAL_BODY_ORDER.map((joint) => frame.joints[joint] ?? missingPoint());
  const leftHand = handPoints(frame.joints, "left");
  const rightHand = handPoints(frame.joints, "right");
  return {
    timestamp: frame.timestamp,
    body,
    face: [],
    leftHand,
    rightHand,
    hands: [leftHand, rightHand].filter((hand) => hand.some((point) => point.visibility !== 0)),
  };
}

function handPoints(
  joints: Partial<Record<CanonicalJoint, CanonicalPoint>>,
  side: "left" | "right",
): Landmark[] {
  const points: Landmark[] = [joints[handWristJoint(side)] ?? missingPoint()];
  for (const finger of ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const) {
    for (let index = 1; index <= 4; index += 1) {
      points.push(joints[handJoint(side, finger, index as FingerJointNumber)] ?? missingPoint());
    }
  }
  return points;
}

function missingPoint(): Landmark {
  return { x: 0, y: 0, z: 0, visibility: 0 };
}

function cameraAxes(point: Landmark): CanonicalPoint {
  return { x: point.x, y: -point.y, z: -point.z, visibility: 1 };
}

function isPoint(value: unknown): value is CanonicalPoint {
  return typeof value === "object" && value !== null &&
    "x" in value && "y" in value && "z" in value;
}

function midpoint(a: CanonicalPoint, b: CanonicalPoint): CanonicalPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function distance(a: CanonicalPoint, b: CanonicalPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function boundsCenter(points: readonly CanonicalPoint[]): CanonicalPoint {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const zs = points.map((point) => point.z);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
}

function boundsScale(points: readonly CanonicalPoint[]): number {
  if (points.length === 0) {
    return 1;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const zs = points.map((point) => point.z);
  return Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    Math.max(...zs) - Math.min(...zs),
    0.04,
  );
}

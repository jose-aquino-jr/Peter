import type { Landmark, LandmarkFrame, LandmarkNormalizer } from "./contracts";

/**
 * A normalização por ombros remove posição e escala da câmera, mas preserva a
 * posição das mãos em relação ao tronco. Sem ombros, o fallback só é adequado
 * para features de forma; não deve ser usado como trajetória corporal.
 */

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const MIN_SCALE = 0.04;

function mapPoints(points: readonly Landmark[], origin: Landmark, scale: number): Landmark[] {
  return points.map((point) => ({
    x: (point.x - origin.x) / scale,
    y: (point.y - origin.y) / scale,
    z: (point.z - origin.z) / scale,
    visibility: point.visibility,
  }));
}

function midpoint(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function distance(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

function fallbackOrigin(frame: LandmarkFrame): { origin: Landmark; scale: number } {
  const points = [
    ...frame.body,
    ...frame.leftHand,
    ...frame.rightHand,
    ...frame.face,
    ...frame.hands.flat(),
  ].filter((point) => (point.visibility ?? 1) >= 0.35);
  if (points.length === 0) {
    return { origin: { x: 0.5, y: 0.5, z: 0 }, scale: 1 };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  return {
    origin: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    scale: Math.max(maxX - minX, maxY - minY, MIN_SCALE),
  };
}

export class ShoulderCenteredNormalizer implements LandmarkNormalizer {
  normalize(frame: LandmarkFrame): LandmarkFrame {
    const leftShoulder = frame.body[LEFT_SHOULDER];
    const rightShoulder = frame.body[RIGHT_SHOULDER];
    const shoulderVisible =
      leftShoulder &&
      rightShoulder &&
      (leftShoulder.visibility ?? 1) >= 0.35 &&
      (rightShoulder.visibility ?? 1) >= 0.35;

    const { origin, scale } = shoulderVisible
      ? {
          origin: midpoint(leftShoulder, rightShoulder),
          scale: Math.max(distance(leftShoulder, rightShoulder), MIN_SCALE),
        }
      : fallbackOrigin(frame);

    const leftHand = mapPoints(frame.leftHand, origin, scale);
    const rightHand = mapPoints(frame.rightHand, origin, scale);

    return {
      timestamp: frame.timestamp,
      body: mapPoints(frame.body, origin, scale),
      face: mapPoints(frame.face, origin, scale),
      leftHand,
      rightHand,
      hands: [leftHand, rightHand].filter((hand) => hand.length > 0),
    };
  }
}

import { describe, expect, it } from "vitest";
import {
  AnimationSkeletonMapper,
  CanonicalSkeletonNormalizer,
  MediaPipeLandmarkMapper,
  canonicalSkeletonToLandmarkFrame,
  type CanonicalSkeletonFrame,
} from "./canonical-skeleton";

const normalizer = new CanonicalSkeletonNormalizer();

describe("Canonical Skeleton v1", () => {
  it("maps MediaPipe body and all 21 hand landmarks to named joints", () => {
    const body = Array.from({ length: 29 }, (_, index) => ({
      x: index / 100,
      y: index / 50,
      z: -index / 200,
    }));
    const hand = Array.from({ length: 21 }, (_, index) => ({
      x: index / 20,
      y: index / 10,
      z: -index / 40,
    }));
    const frame = new MediaPipeLandmarkMapper().map({
      timestamp: 100,
      body,
      leftHand: hand,
      rightHand: [],
      face: [],
      hands: [hand],
    });

    expect(frame.joints.leftShoulder).toEqual({ x: 0.11, y: -0.22, z: 0.055, visibility: 1 });
    expect(frame.joints.leftHandWrist?.x).toBe(0);
    expect(frame.joints.leftThumb1?.x).toBe(1 / 20);
    expect(frame.joints.leftPinky4?.x).toBe(1);
    const encoded = canonicalSkeletonToLandmarkFrame(frame);
    expect(encoded.body).toHaveLength(13);
    expect(encoded.body[1]).toEqual(frame.joints.leftShoulder);
    expect(encoded.leftHand).toHaveLength(21);
  });

  it("maps configured animation bones to the same canonical names", () => {
    const mapper = new AnimationSkeletonMapper({
      leftShoulder: { bone: "source_shoulder_l", point: "head" },
      rightShoulder: { bone: "source_shoulder_r", point: "head" },
      leftWrist: { bone: "source_hand_l", point: "tail" },
    });
    const frame = mapper.map([
      {
        name: "source_shoulder_l",
        head: { x: -1, y: 2, z: 0 },
        tail: { x: -1, y: 1, z: 0 },
      },
      {
        name: "source_shoulder_r",
        head: { x: 1, y: 2, z: 0 },
        tail: { x: 1, y: 1, z: 0 },
      },
      {
        name: "source_hand_l",
        head: { x: -2, y: 0, z: 0 },
        tail: { x: -3, y: 0, z: 0 },
      },
    ], 42);

    expect(frame.joints.leftShoulder?.x).toBe(-1);
    expect(frame.joints.leftWrist?.x).toBe(-3);
    expect(canonicalSkeletonToLandmarkFrame(frame).body[1]?.x).toBe(-1);
  });

  it("encodes camera and mapped animation points into identical matching inputs", () => {
    const camera = new MediaPipeLandmarkMapper().map({
      timestamp: 10,
      body: Array.from({ length: 29 }, (_, index) => ({
        x: index / 30,
        y: index / 20,
        z: -index / 60,
      })),
      leftHand: Array.from({ length: 21 }, (_, index) => ({
        x: index / 15,
        y: index / 25,
        z: -index / 50,
      })),
      rightHand: [],
      face: [],
      hands: [],
    });
    const boneMap = Object.fromEntries(
      Object.entries(camera.joints).map(([joint]) => [
        joint,
        { bone: `bone_${joint}`, point: "head" as const },
      ]),
    );
    const samples = Object.entries(camera.joints).map(([joint, point]) => ({
      name: `bone_${joint}`,
      head: point!,
      tail: point!,
    }));
    const animation = new AnimationSkeletonMapper(boneMap).map(samples, 10);
    const cameraFrame = canonicalSkeletonToLandmarkFrame(normalizer.normalize(camera));
    const animationFrame = canonicalSkeletonToLandmarkFrame(normalizer.normalize(animation));

    expect(animationFrame.body).toEqual(cameraFrame.body);
    expect(animationFrame.leftHand).toEqual(cameraFrame.leftHand);
    expect(animationFrame.rightHand).toEqual(cameraFrame.rightHand);
  });

  it("removes translation and scale using the same shoulder normalization", () => {
    const original: CanonicalSkeletonFrame = {
      timestamp: 1,
      joints: {
        leftShoulder: { x: -1, y: 2, z: 0 },
        rightShoulder: { x: 1, y: 2, z: 0 },
        leftWrist: { x: -2, y: 0, z: 1 },
      },
    };
    const transformed: CanonicalSkeletonFrame = {
      timestamp: 2,
      joints: Object.fromEntries(
        Object.entries(original.joints).map(([joint, point]) => [
          joint,
          { x: point!.x * 3 + 8, y: point!.y * 3 - 4, z: point!.z * 3 + 2 },
        ]),
      ),
    };

    expect(normalizer.normalize(transformed).joints)
      .toEqual(normalizer.normalize(original).joints);
  });
});

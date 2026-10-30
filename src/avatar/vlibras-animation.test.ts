import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { VLibrasSimAnimation, VLibrasSimBindings } from "./vlibras-sim";
import {
  RetargetedAnimationPlayer,
  curveForBinding,
  movingQuaternionCurves,
  retargetRelativeQuaternion,
  sampleQuaternionCurve,
  sourceLocalDeltaToThree,
  sourceRelativeQuaternionAt,
  unityQuaternionToThree,
} from "./vlibras-animation";

describe("VLibras SIM source animation", () => {
  it("loads the extracted source keyframes and preserves the effective keyframe duration", () => {
    expect(VLibrasSimAnimation.source.bundleSha256).toBe("6fd5587f32631058b4ad58d92eb43862661a8c483c531e4a997f4a3c42b49569");
    expect(VLibrasSimAnimation.source.clipName).toBe("SIM");
    expect(VLibrasSimAnimation.curves).toHaveLength(274);
    expect(VLibrasSimAnimation.durationSeconds).toBeCloseTo(3.400000095, 6);
    expect(VLibrasSimAnimation.source.muscleClipStopTime).toBe(1);
    expect(movingQuaternionCurves(VLibrasSimAnimation)).toHaveLength(27);
    expect(VLibrasSimAnimation.curves.some((curve) =>
      curve.category === "rotation" && curve.path?.includes("BnDedo.1.R") && curve.keys.length > 2,
    )).toBe(true);
  });

  it("uses explicit source paths from the clip and leaves ambiguous numbered fingers unmapped", () => {
    expect(VLibrasSimBindings).toHaveLength(6);
    for (const binding of VLibrasSimBindings) {
      const curve = curveForBinding(VLibrasSimAnimation, binding);
      expect(curve, binding.sourcePath).toBeDefined();
      expect(curve?.keys.length).toBeGreaterThan(1);
    }
    expect(VLibrasSimBindings.some((binding) => binding.sourcePath.includes("BnDedo"))).toBe(false);
    expect(VLibrasSimBindings.map((binding) => binding.targetHumanoidBone)).toEqual([
      "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand",
    ]);
    const movingPaths = new Set(movingQuaternionCurves(VLibrasSimAnimation).map((curve) => curve.path));
    expect(VLibrasSimBindings.filter((binding) => movingPaths.has(binding.sourcePath))).toHaveLength(5);
  });

  it("converts a Unity basis reflection and preserves the identity reference pose", () => {
    const sourceXQuarterTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const converted = unityQuaternionToThree([
      sourceXQuarterTurn.x, sourceXQuarterTurn.y, sourceXQuarterTurn.z, sourceXQuarterTurn.w,
    ]);
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), Math.PI / 2);
    expect(converted.angleTo(expected)).toBeLessThan(1e-6);

    const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.3, 0.1));
    const tuple: [number, number, number, number] = [0.1, 0.2, -0.1, 0.96];
    const first = new THREE.Quaternion(...tuple).normalize();
    const atReference = retargetRelativeQuaternion(tuple, [first.x, first.y, first.z, first.w], rest);
    expect(atReference.angleTo(rest)).toBeLessThan(1e-6);
  });

  it("retargets one real hand frame in its parent frame, includes the source twist segment, and restores it", () => {
    const binding = VLibrasSimBindings.find((entry) => entry.targetHumanoidBone === "rightHand")!;
    const sampleTime = 1.7;
    const targetRoot = new THREE.Object3D();
    const leftShoulder = new THREE.Object3D();
    const leftUpperArm = new THREE.Object3D();
    const leftLowerArm = new THREE.Object3D();
    const leftHand = new THREE.Object3D();
    const rightShoulder = new THREE.Object3D();
    const upperArm = new THREE.Object3D();
    const lowerArm = new THREE.Object3D();
    const hand = new THREE.Object3D();
    targetRoot.add(leftShoulder, rightShoulder);
    leftShoulder.add(leftUpperArm);
    leftUpperArm.add(leftLowerArm);
    leftLowerArm.add(leftHand);
    rightShoulder.add(upperArm);
    upperArm.add(lowerArm);
    lowerArm.add(hand);
    upperArm.rotation.z = -1.25; // Same default normalized VRM pose as createRuntimePort.
    targetRoot.updateMatrixWorld(true);
    const targetUpperRest = upperArm.quaternion.clone();
    const targetInitialLocal = hand.quaternion.clone();
    const player = new RetargetedAnimationPlayer();
    const nodeByBone = new Map([
      ["leftUpperArm", leftUpperArm], ["leftLowerArm", leftLowerArm], ["leftHand", leftHand],
      ["rightUpperArm", upperArm], ["rightLowerArm", lowerArm], ["rightHand", hand],
    ]);
    const result = player.start(VLibrasSimAnimation, VLibrasSimBindings, (bone) => nodeByBone.get(bone));
    expect(result).toEqual({ mapped: 6, unmappedRotations: 78 });

    const sourceParentPath = VLibrasSimBindings.find((entry) => entry.targetHumanoidBone === "rightLowerArm")!.sourcePath;
    const relativeAtStart = sourceRelativeQuaternionAt(
      VLibrasSimAnimation, sourceParentPath, binding.sourcePath, 0,
    )!;
    const relativeAtSample = sourceRelativeQuaternionAt(
      VLibrasSimAnimation, sourceParentPath, binding.sourcePath, sampleTime,
    )!;
    expect(relativeAtStart.angleTo(relativeAtSample)).toBeGreaterThan(0.1);
    const expectedLocal = targetInitialLocal.clone().multiply(sourceLocalDeltaToThree(
      VLibrasSimAnimation, sourceParentPath, binding.sourcePath, sampleTime,
    )!).normalize();
    const upperArmBinding = VLibrasSimBindings.find((entry) => entry.targetHumanoidBone === "rightUpperArm")!;
    const expectedUpperLocal = targetUpperRest.clone().multiply(sourceLocalDeltaToThree(
      VLibrasSimAnimation,
      upperArmBinding.sourcePath.slice(0, upperArmBinding.sourcePath.lastIndexOf("/")),
      upperArmBinding.sourcePath,
      sampleTime,
    )!).normalize();

    player.update(sampleTime);
    const appliedLocal = hand.quaternion.clone();
    expect(appliedLocal.angleTo(expectedLocal)).toBeLessThan(1e-5);
    expect(upperArm.quaternion.angleTo(expectedUpperLocal)).toBeLessThan(1e-5);

    player.cancel();
    expect(hand.quaternion.angleTo(targetInitialLocal)).toBeLessThan(1e-6);
  });

  it("holds the last source key through the actual curve timeline", () => {
    const binding = VLibrasSimBindings.find((entry) => entry.targetHumanoidBone === "rightLowerArm")!;
    const curve = curveForBinding(VLibrasSimAnimation, binding)!;
    const target = new THREE.Object3D();
    const player = new RetargetedAnimationPlayer();
    player.start(VLibrasSimAnimation, [binding], () => target);
    player.update(VLibrasSimAnimation.durationSeconds);
    const last = sampleQuaternionCurve(curve, VLibrasSimAnimation.durationSeconds)!;
    const lastKey = curve.keys[curve.keys.length - 1].value as { x: number; y: number; z: number; w: number };
    expect(last.angleTo(new THREE.Quaternion(lastKey.x, lastKey.y, lastKey.z, lastKey.w).normalize())).toBeLessThan(1e-6);
    player.cancel();
  });
});

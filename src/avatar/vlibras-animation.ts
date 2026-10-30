import * as THREE from "three";

export interface VlibrasKey<T> {
  readonly time: number;
  readonly value: T;
  readonly inSlope: unknown;
  readonly outSlope: unknown;
  readonly weightedMode: number | null;
}

export interface VlibrasCurve {
  readonly category: "rotation" | "position" | "scale" | "float" | "compressedRotation" | "euler" | "pptr";
  readonly path: string | null;
  readonly attribute: string | null;
  readonly keyCount: number;
  readonly keys: readonly VlibrasKey<unknown>[];
}

export interface VlibrasAnimation {
  readonly schemaVersion: number;
  readonly gloss: string;
  readonly durationSeconds: number;
  readonly source: {
    readonly bundleSha256: string;
    readonly clipName: string;
    readonly sampleRate: number;
    readonly muscleClipStartTime: number;
    readonly muscleClipStopTime: number;
  };
  readonly curves: readonly VlibrasCurve[];
}

export interface RetargetBinding {
  readonly sourcePath: string;
  readonly targetHumanoidBone: VRMHumanoidBone;
  /** Explicitly names the target bone; no name-similarity fallback is performed. */
  readonly evidence: string;
}

export type VRMHumanoidBone =
  | "leftUpperArm" | "rightUpperArm"
  | "leftLowerArm" | "rightLowerArm"
  | "leftHand" | "rightHand";

const sourceTorso = "Armature.001/BnBacia.001/BnCol-01/BnCol-02/BnCol-03";

/** Paths were read verbatim from the SIM AnimationClip; no fuzzy name matching. */
export const VLibrasSimBindings: readonly RetargetBinding[] = [
  {
    sourcePath: `${sourceTorso}/BnOmbro.L/BnBraco.L`,
    targetHumanoidBone: "leftUpperArm",
    evidence: "Exact source path BnOmbro.L/BnBraco.L; maps the named upper-arm segment.",
  },
  {
    sourcePath: `${sourceTorso}/BnOmbro.L/BnBraco.L/BnAntBraco.L`,
    targetHumanoidBone: "leftLowerArm",
    evidence: "Exact child segment named BnAntBraco.L under the left BnBraco.L.",
  },
  {
    sourcePath: `${sourceTorso}/BnOmbro.L/BnBraco.L/BnAntBraco.L/BnAntBraco.L.001/BnMao.L`,
    targetHumanoidBone: "leftHand",
    evidence: "Exact source node BnMao.L; intermediate .001 twist segment has no VRM equivalent and is omitted.",
  },
  {
    sourcePath: `${sourceTorso}/BnOmbro.R/BnBraco.R`,
    targetHumanoidBone: "rightUpperArm",
    evidence: "Exact source path BnOmbro.R/BnBraco.R; maps the named upper-arm segment.",
  },
  {
    sourcePath: `${sourceTorso}/BnOmbro.R/BnBraco.R/BnAntBraco.R`,
    targetHumanoidBone: "rightLowerArm",
    evidence: "Exact child segment named BnAntBraco.R under the right BnBraco.R.",
  },
  {
    sourcePath: `${sourceTorso}/BnOmbro.R/BnBraco.R/BnAntBraco.R/BnAntBraco.R.001/BnMao.R`,
    targetHumanoidBone: "rightHand",
    evidence: "Exact source node BnMao.R; intermediate .001 twist segment has no VRM equivalent and is omitted.",
  },
];

export interface QuaternionKey {
  readonly time: number;
  readonly value: readonly [number, number, number, number];
}

/** Unity local coordinates are converted to Three's right-handed basis by SRS^-1. */
export function unityQuaternionToThree(value: readonly [number, number, number, number]): THREE.Quaternion {
  const source = new THREE.Quaternion(value[0], value[1], value[2], value[3]).normalize();
  const basisReflection = new THREE.Matrix4().makeScale(1, 1, -1);
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(source);
  const converted = basisReflection.clone().multiply(rotation).multiply(basisReflection);
  return new THREE.Quaternion().setFromRotationMatrix(converted).normalize();
}

/** Compute reference-relative local rotation, then apply it after target rest rotation. */
export function retargetRelativeQuaternion(
  reference: readonly [number, number, number, number],
  current: readonly [number, number, number, number],
  targetRest: THREE.Quaternion,
): THREE.Quaternion {
  const referenceQ = new THREE.Quaternion(...reference).normalize();
  const currentQ = new THREE.Quaternion(...current).normalize();
  // Local delta: q(t) = q(0) * delta, therefore delta = inverse(q(0)) * q(t).
  const sourceDelta = referenceQ.invert().multiply(currentQ).normalize();
  const convertedDelta = unityQuaternionToThree([
    sourceDelta.x, sourceDelta.y, sourceDelta.z, sourceDelta.w,
  ]);
  // Three.js multiply is right-multiplication: targetRest * localDelta.
  return targetRest.clone().multiply(convertedDelta).normalize();
}

export function sampleQuaternionCurve(curve: VlibrasCurve, time: number): THREE.Quaternion | undefined {
  if (curve.category !== "rotation" || curve.keys.length === 0) return undefined;
  const keys = curve.keys as readonly VlibrasKey<{ x: number; y: number; z: number; w: number }>[];
  if (time <= keys[0].time) return quaternion(keys[0].value);
  const last = keys[keys.length - 1];
  if (time >= last.time) return quaternion(last.value);
  let upper = 1;
  while (upper < keys.length && keys[upper].time < time) upper += 1;
  const a = keys[upper - 1];
  const b = keys[upper];
  const span = b.time - a.time;
  const alpha = span > 0 ? (time - a.time) / span : 1;
  return quaternion(a.value).slerp(quaternion(b.value), alpha).normalize();
}

export function movingQuaternionCurves(animation: VlibrasAnimation): readonly VlibrasCurve[] {
  return animation.curves.filter((curve) => {
    if (curve.category !== "rotation" || curve.keys.length < 2) return false;
    const keys = curve.keys as readonly VlibrasKey<{ x: number; y: number; z: number; w: number }>[];
    const initial = quaternion(keys[0].value);
    return keys.some((key) => 1 - Math.abs(initial.dot(quaternion(key.value))) > 1e-7);
  });
}

export function quaternionTuple(curve: VlibrasCurve, keyIndex: number): [number, number, number, number] | undefined {
  const key = curve.keys[keyIndex];
  if (!key || !key.value || typeof key.value !== "object") return undefined;
  const value = key.value as { x?: unknown; y?: unknown; z?: unknown; w?: unknown };
  if (![value.x, value.y, value.z, value.w].every((part) => typeof part === "number")) return undefined;
  return [value.x as number, value.y as number, value.z as number, value.w as number];
}

export function curveForBinding(animation: VlibrasAnimation, binding: RetargetBinding): VlibrasCurve | undefined {
  return animation.curves.find((curve) =>
    curve.category === "rotation" && curve.path === binding.sourcePath,
  );
}

/** Compose Unity's path-local rotations from the animation root to a transform. */
export function sourceWorldQuaternionAt(
  animation: VlibrasAnimation,
  path: string,
  time: number,
): THREE.Quaternion | undefined {
  const segments = path.split("/");
  const world = new THREE.Quaternion();
  for (let index = 0; index < segments.length; index += 1) {
    const ancestorPath = segments.slice(0, index + 1).join("/");
    const curve = animation.curves.find((entry) =>
      entry.category === "rotation" && entry.path === ancestorPath,
    );
    const local = curve ? sampleQuaternionCurve(curve, time) : undefined;
    // Missing ancestors cannot safely be treated as identity rotations.
    if (!local) return undefined;
    world.multiply(local);
  }
  return world.normalize();
}

/**
 * World-space angular change from a Unity clip is left-composed (current * inverse(reference)).
 * Convert after composition so animated parents and omitted source twist bones are included.
 */
export function sourceWorldDeltaToThree(
  animation: VlibrasAnimation,
  path: string,
  time: number,
  referenceTime = 0,
): THREE.Quaternion | undefined {
  const reference = sourceWorldQuaternionAt(animation, path, referenceTime);
  const current = sourceWorldQuaternionAt(animation, path, time);
  if (!reference || !current) return undefined;
  const deltaWorld = current.multiply(reference.invert()).normalize();
  return unityQuaternionToThree([deltaWorld.x, deltaWorld.y, deltaWorld.z, deltaWorld.w]);
}

/** Get a transform's orientation in its mapped parent frame, including intervening source joints. */
export function sourceRelativeQuaternionAt(
  animation: VlibrasAnimation,
  parentPath: string,
  path: string,
  time: number,
): THREE.Quaternion | undefined {
  const parentWorld = sourceWorldQuaternionAt(animation, parentPath, time);
  const boneWorld = sourceWorldQuaternionAt(animation, path, time);
  if (!parentWorld || !boneWorld) return undefined;
  return parentWorld.invert().multiply(boneWorld).normalize();
}

/** Local motion delta: inverse(reference-relative) * current-relative, applied on the right. */
export function sourceLocalDeltaToThree(
  animation: VlibrasAnimation,
  parentPath: string,
  path: string,
  time: number,
  referenceTime = 0,
): THREE.Quaternion | undefined {
  const reference = sourceRelativeQuaternionAt(animation, parentPath, path, referenceTime);
  const current = sourceRelativeQuaternionAt(animation, parentPath, path, time);
  if (!reference || !current) return undefined;
  const deltaLocal = reference.invert().multiply(current).normalize();
  return unityQuaternionToThree([deltaLocal.x, deltaLocal.y, deltaLocal.z, deltaLocal.w]);
}

export class RetargetedAnimationPlayer {
  private elapsed = 0;
  private duration = 0;
  private channels: Array<{
    readonly curve: VlibrasCurve;
    readonly sourceParentPath: string;
    readonly sourcePath: string;
    readonly node: THREE.Object3D;
    readonly targetRestLocal: THREE.Quaternion;
  }> = [];

  start(
    animation: VlibrasAnimation,
    bindings: readonly RetargetBinding[],
    resolveBone: (name: VRMHumanoidBone) => THREE.Object3D | null | undefined,
  ): { readonly mapped: number; readonly unmappedRotations: number } {
    this.cancel();
    this.elapsed = 0;
    this.duration = animation.durationSeconds;
    this.animation = animation;
    for (const binding of bindings) {
      const curve = curveForBinding(animation, binding);
      const node = resolveBone(binding.targetHumanoidBone);
      const mappedParent = bindings
        .filter((candidate) => binding.sourcePath.startsWith(`${candidate.sourcePath}/`))
        .sort((a, b) => b.sourcePath.length - a.sourcePath.length)[0];
      const sourceParentPath = mappedParent?.sourcePath ?? binding.sourcePath.slice(0, binding.sourcePath.lastIndexOf("/"));
      const sourceReference = curve && sourceRelativeQuaternionAt(animation, sourceParentPath, binding.sourcePath, 0);
      if (!curve || !node || !sourceReference || curve.keys.length < 2) continue;
      node.updateWorldMatrix(true, false);
      this.channels.push({
        curve,
        sourceParentPath,
        sourcePath: binding.sourcePath,
        node,
        targetRestLocal: node.quaternion.clone(),
      });
    }
    this.channels.sort((a, b) => depth(a.node) - depth(b.node));
    const mappedPaths = new Set(bindings.map((binding) => binding.sourcePath));
    const unmappedRotations = animation.curves.filter((curve) =>
      curve.category === "rotation" && curve.path && !mappedPaths.has(curve.path),
    ).length;
    return { mapped: this.channels.length, unmappedRotations };
  }

  update(deltaSeconds: number): void {
    if (this.channels.length === 0) return;
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, deltaSeconds));
    for (const channel of this.channels) {
      const localDelta = sourceLocalDeltaToThree(
        this.animation!, channel.sourceParentPath, channel.sourcePath, this.elapsed,
      );
      if (!localDelta) continue;
      // Apply parent-frame motion to the normalized bone's captured local pose.
      // Its target hierarchy composes the parent motion exactly once.
      channel.node.quaternion.copy(channel.targetRestLocal).multiply(localDelta).normalize();
      channel.node.updateWorldMatrix(false, true);
    }
  }

  cancel(): void {
    for (const channel of this.channels) channel.node.quaternion.copy(channel.targetRestLocal);
    this.channels = [];
    this.elapsed = 0;
    this.duration = 0;
    this.animation = undefined;
  }

  private animation: VlibrasAnimation | undefined;
}

function depth(node: THREE.Object3D): number {
  let result = 0;
  for (let current: THREE.Object3D | null = node; current?.parent; current = current.parent) result += 1;
  return result;
}

function quaternion(value: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(value.x, value.y, value.z, value.w).normalize();
}

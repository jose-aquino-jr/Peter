import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { logger } from "../core/logger";
import type { Gesture } from "../core/messages";
import type { CanonicalJoint, CanonicalSkeletonFrame } from "../vision/pipeline/canonical-skeleton";
import type { AvatarRuntimePort, VrmAvatarController } from "./vrm-avatar-controller";
import {
  RetargetedAnimationPlayer,
} from "./vlibras-animation";
import type { RetargetBinding, VlibrasAnimation } from "./vlibras-animation";

export function mountVrmAvatar(
  canvas: HTMLCanvasElement,
  modelUrl: string,
  controller: VrmAvatarController,
): () => void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#151922");
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene.add(new THREE.HemisphereLight(0xe5edff, 0x313746, 2.1));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-2, 4, -4);
  scene.add(keyLight);

  let vrm: VRM | undefined;
  let runtimePort: AvatarRuntimePort | undefined;
  let detachRuntime: (() => void) | undefined;
  let frameId = 0;
  let previousFrame = performance.now();
  let disposed = false;
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (width === 0 || height === 0) {
      return;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const render = (now: number) => {
    frameId = requestAnimationFrame(render);
    const delta = Math.min((now - previousFrame) / 1000, 0.05);
    previousFrame = now;
    vrm?.update(delta);
    runtimePort?.update(delta);
    renderer.render(scene, camera);
  };
  frameId = requestAnimationFrame(render);

  loader.load(
    modelUrl,
    (gltf) => {
      const loadedVrm = gltf.userData.vrm;
      if (!(loadedVrm instanceof VRM)) {
        VRMUtils.deepDispose(gltf.scene);
        if (!disposed) {
          controller.reportRuntimeError("O arquivo selecionado não contém um VRM válido.");
        }
        return;
      }
      if (disposed) {
        VRMUtils.deepDispose(loadedVrm.scene);
        return;
      }

      vrm = loadedVrm;
      scene.add(vrm.scene);
      vrm.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(vrm.scene);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const distance = Math.max(size.y * 1.9, 2.4);
      // VRM faces toward the viewer on +Z in the normalized scene. Placing the
      // camera on +Z avoids presenting the model from behind by default.
      camera.position.set(center.x, center.y + size.y * 0.04, center.z - distance);
      camera.lookAt(center);
      vrm.lookAt?.lookAt(new THREE.Vector3(center.x, center.y + size.y * 0.15, center.z + 5));
      runtimePort = createRuntimePort(vrm);
      detachRuntime = controller.attachRuntime(runtimePort);
      logger.info("avatar", "VRM loaded");
    },
    undefined,
    (error) => {
      if (!disposed) {
        const message =
          error instanceof Error ? error.message : "Falha ao carregar o arquivo VRM.";
        controller.reportRuntimeError(message);
      }
    },
  );

  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    detachRuntime?.();
    if (vrm) {
      scene.remove(vrm.scene);
      VRMUtils.deepDispose(vrm.scene);
    }
    renderer.dispose();
  };
}

function applyLibrasFrame(
  frame: CanonicalSkeletonFrame,
  leftArm: THREE.Object3D | undefined,
  leftForearm: THREE.Object3D | undefined,
  leftHand: THREE.Object3D | undefined,
  rightArm: THREE.Object3D | undefined,
  rightForearm: THREE.Object3D | undefined,
  rightHand: THREE.Object3D | undefined,
  leftRest: THREE.Euler | undefined,
  rightRest: THREE.Euler | undefined,
  leftFingers: FingerRig,
  rightFingers: FingerRig,
  leftFingerRest: FingerRigRest,
  rightFingerRest: FingerRigRest,
): void {
  applyLibrasSide(frame, "left", leftArm, leftForearm, leftHand, leftRest, leftFingers, leftFingerRest);
  applyLibrasSide(frame, "right", rightArm, rightForearm, rightHand, rightRest, rightFingers, rightFingerRest);
}

const FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;
type FingerName = (typeof FINGER_NAMES)[number];
type FingerRig = Record<FingerName, Array<THREE.Object3D | undefined>>;
type FingerRigRest = Record<FingerName, Array<THREE.Euler | undefined>>;

function applyLibrasSide(
  frame: CanonicalSkeletonFrame,
  side: "left" | "right",
  arm: THREE.Object3D | undefined,
  forearm: THREE.Object3D | undefined,
  hand: THREE.Object3D | undefined,
  rest: THREE.Euler | undefined,
  fingers: FingerRig,
  fingerRest: FingerRigRest,
): void {
  if (!arm || !rest) return;
  const shoulder = frame.joints[`${side}Shoulder`];
  const elbow = frame.joints[`${side}Elbow`];
  const wrist = frame.joints[`${side}Wrist`];
  arm.rotation.copy(rest);
  if (!shoulder || !elbow || !wrist) return;
  const pose = canonicalArmRotationOffsets(frame, side);
  arm.rotation.x += pose.armX;
  arm.rotation.y += pose.armY;
  arm.rotation.z += pose.armZ;
  if (forearm) {
    forearm.rotation.y = pose.forearmY;
    forearm.rotation.z = pose.forearmZ;
  }
  if (hand) {
    const handWrist = frame.joints[`${side}HandWrist`];
    const indexBase = frame.joints[`${side}Index1`];
    if (handWrist && indexBase) {
      // Orient the hand from its wrist-to-index direction, rather than using
      // the wrist's absolute z coordinate as an unrelated rotation value.
      const handDirection = new THREE.Vector3(
        indexBase.x - handWrist.x,
        indexBase.y - handWrist.y,
        -(indexBase.z - handWrist.z),
      ).normalize();
      hand.rotation.x = THREE.MathUtils.clamp(Math.atan2(handDirection.z, handDirection.y), -0.8, 0.8);
      hand.rotation.z = THREE.MathUtils.clamp(Math.atan2(handDirection.x, handDirection.y), -0.8, 0.8);
    }
  }
  const flexions = canonicalFingerFlexions(frame, side);
  for (const finger of FINGER_NAMES) {
    fingers[finger].forEach((bone, index) => {
      const base = fingerRest[finger][index];
      if (!bone || !base) return;
      bone.rotation.copy(base);
      bone.rotation.x += (side === "left" ? 1 : -1) * flexions[finger][index];
    });
  }
}

export type CanonicalFingerFlexions = Readonly<Record<FingerName, readonly number[]>>;

/** Convert template finger landmarks into per-joint flexion angles (radians). */
export function canonicalFingerFlexions(
  frame: CanonicalSkeletonFrame,
  side: "left" | "right",
): CanonicalFingerFlexions {
  const result = {} as Record<FingerName, readonly number[]>;
  const wrist = frame.joints[`${side}HandWrist`];
  for (const finger of FINGER_NAMES) {
    const points = [1, 2, 3, 4].map((joint) =>
      frame.joints[`${side}${finger}${joint}` as CanonicalJoint],
    );
    if (!wrist || points.some((point) => !point || (point.visibility ?? 1) < 0.35)) {
      result[finger] = [0, 0, 0];
      continue;
    }
    const [one, two, three, four] = points as [
      NonNullable<(typeof points)[number]>,
      NonNullable<(typeof points)[number]>,
      NonNullable<(typeof points)[number]>,
      NonNullable<(typeof points)[number]>,
    ];
    result[finger] = [
      fingerBend(wrist, one, two),
      fingerBend(one, two, three),
      fingerBend(two, three, four),
    ];
  }
  return result;
}

function fingerBend(
  start: { readonly x: number; readonly y: number; readonly z: number },
  joint: { readonly x: number; readonly y: number; readonly z: number },
  next: { readonly x: number; readonly y: number; readonly z: number },
): number {
  const incoming = new THREE.Vector3(joint.x - start.x, joint.y - start.y, joint.z - start.z);
  const outgoing = new THREE.Vector3(next.x - joint.x, next.y - joint.y, next.z - joint.z);
  if (incoming.lengthSq() < 1e-8 || outgoing.lengthSq() < 1e-8) return 0;
  const bend = Math.PI - incoming.normalize().angleTo(outgoing.normalize());
  return THREE.MathUtils.clamp(bend, 0, 1.2);
}

export interface CanonicalArmRotationOffsets {
  readonly armX: number;
  readonly armY: number;
  readonly armZ: number;
  readonly forearmY: number;
  readonly forearmZ: number;
}

/** Convert the shoulder-relative 3D canonical coordinates to avatar rotations. */
export function canonicalArmRotationOffsets(
  frame: CanonicalSkeletonFrame,
  side: "left" | "right",
): CanonicalArmRotationOffsets {
  const shoulder = frame.joints[`${side}Shoulder`];
  const elbow = frame.joints[`${side}Elbow`];
  const wrist = frame.joints[`${side}Wrist`];
  if (!shoulder || !elbow || !wrist) {
    return { armX: 0, armY: 0, armZ: 0, forearmY: 0, forearmZ: 0 };
  }
  const dx = wrist.x - shoulder.x;
  const dy = wrist.y - shoulder.y;
  // Canonical z points toward the camera; the VRM is viewed from -Z.
  const dz = -(wrist.z - shoulder.z);
  const reach = Math.max(0.2, Math.hypot(dx, dy, dz));
  const horizontal = THREE.MathUtils.clamp(dx / reach, -1, 1);
  const vertical = THREE.MathUtils.clamp(dy / reach, -1, 1);
  const depth = THREE.MathUtils.clamp(dz / reach, -1, 1);
  const direction = side === "left" ? 1 : -1;
  const forearmReach = Math.max(0.1, reach);
  const forearmDy = wrist.y - elbow.y;
  const forearmDz = -(wrist.z - elbow.z);
  return {
    armX: horizontal * 0.75,
    armY: direction * depth * 0.8,
    armZ: direction * vertical * 0.95,
    forearmY: direction * THREE.MathUtils.clamp(forearmDz / forearmReach, -1, 1) * 0.55,
    forearmZ: direction * THREE.MathUtils.clamp(forearmDy / forearmReach, -1, 1) * 0.55,
  };
}

function createFingerRig(vrm: VRM, side: "left" | "right"): FingerRig {
  const rig = {} as FingerRig;
  for (const finger of FINGER_NAMES) {
    const boneNames = finger === "Thumb"
      ? [`${side}ThumbMetacarpal`, `${side}ThumbProximal`, `${side}ThumbDistal`]
      : [`${side}${finger}Proximal`, `${side}${finger}Intermediate`, `${side}${finger}Distal`];
    rig[finger] = boneNames.map((name) =>
      vrm.humanoid.getNormalizedBoneNode(name as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0]) ?? undefined,
    );
  }
  return rig;
}

function snapshotFingerRig(rig: FingerRig): FingerRigRest {
  const rest = {} as FingerRigRest;
  for (const finger of FINGER_NAMES) {
    rest[finger] = rig[finger].map((bone) => bone?.rotation.clone());
  }
  return rest;
}

function restoreFingerRig(rig: FingerRig, rest: FingerRigRest): void {
  for (const finger of FINGER_NAMES) {
    rig[finger].forEach((bone, index) => {
      const base = rest[finger][index];
      if (bone && base) bone.rotation.copy(base);
    });
  }
}

function createRuntimePort(vrm: VRM): AvatarRuntimePort {
  const leftArm = vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
  const leftForearm = vrm.humanoid.getNormalizedBoneNode("leftLowerArm");
  const leftHand = vrm.humanoid.getNormalizedBoneNode("leftHand");
  const rightArm = vrm.humanoid.getNormalizedBoneNode("rightUpperArm");
  const rightForearm = vrm.humanoid.getNormalizedBoneNode("rightLowerArm");
  const rightHand = vrm.humanoid.getNormalizedBoneNode("rightHand");
  const leftFingers = createFingerRig(vrm, "left");
  const rightFingers = createFingerRig(vrm, "right");
  const leftFingerRest = snapshotFingerRig(leftFingers);
  const rightFingerRest = snapshotFingerRig(rightFingers);
  const head = vrm.humanoid.getNormalizedBoneNode("head");

  // In VRM normalized humanoid space, zero rotations are the model's T-pose.
  // Rotate each upper arm around its shoulder axis so the arms descend naturally.
  leftArm?.rotation.set(0, 0, 1.25);
  leftForearm?.rotation.set(0, 0, 0);
  leftHand?.rotation.set(0, 0, 0);
  rightArm?.rotation.set(0, 0, -1.25);
  rightForearm?.rotation.set(0, 0, 0);
  rightHand?.rotation.set(0, 0, 0);
  const baseLeftArm = leftArm?.rotation.clone();
  const baseLeftForearm = leftForearm?.rotation.clone();
  const baseLeftHand = leftHand?.rotation.clone();
  const baseArm = rightArm?.rotation.clone();
  const baseForearm = rightForearm?.rotation.clone();
  const baseHand = rightHand?.rotation.clone();
  const baseHead = head?.rotation.clone();
  let activeGesture: Gesture | undefined;
  let elapsed = 0;
  let librasFrames: readonly CanonicalSkeletonFrame[] = [];
  let librasElapsedMs = 0;
  const sourceAnimationPlayer = new RetargetedAnimationPlayer();

  return {
    playGesture(gesture) {
      activeGesture = gesture;
      elapsed = 0;
    },
    setEmotion(emotion) {
      const manager = vrm.expressionManager;
      if (!manager) {
        logger.warn("avatar", "This VRM has no expression manager");
        return;
      }
      for (const expression of manager.expressions) {
        manager.setValue(expression.expressionName, 0);
      }
      const expressionName = emotion === "thinking" ? "relaxed" : emotion;
      if (manager.getExpression(expressionName)) {
        manager.setValue(expressionName, emotion === "neutral" ? 0 : 1);
      } else if (emotion !== "neutral") {
        logger.warn("avatar", `VRM expression "${expressionName}" is unavailable`);
      }
    },
    lookAt() {
      vrm.lookAt?.lookAt(new THREE.Vector3(0, 1.5, -5));
    },
    playLibrasFrames(frames) {
      this.cancelSourceAnimation();
      activeGesture = undefined;
      librasFrames = frames;
      librasElapsedMs = 0;
    },
    cancelLibrasFrames() {
      librasFrames = [];
      librasElapsedMs = 0;
    },
    playSourceAnimation(animation: VlibrasAnimation, bindings: readonly RetargetBinding[]) {
      this.cancelLibrasFrames();
      this.cancelSourceAnimation();
      activeGesture = undefined;
      const result = sourceAnimationPlayer.start(
        animation,
        bindings,
        (bone) => vrm.humanoid.getNormalizedBoneNode(bone),
      );
      logger.info("VRM", `Aplicando ${result.mapped} canais humanoides; ${result.unmappedRotations} curvas de rotação sem mapeamento seguro`);
    },
    cancelSourceAnimation() {
      sourceAnimationPlayer.cancel();
    },
    stopGesture() {
      activeGesture = undefined;
      if (leftArm && baseLeftArm) {
        leftArm.rotation.copy(baseLeftArm);
      }
      if (leftForearm && baseLeftForearm) {
        leftForearm.rotation.copy(baseLeftForearm);
      }
      if (leftHand && baseLeftHand) {
        leftHand.rotation.copy(baseLeftHand);
      }
      if (rightArm && baseArm) {
        rightArm.rotation.copy(baseArm);
      }
      if (rightForearm && baseForearm) {
        rightForearm.rotation.copy(baseForearm);
      }
      if (rightHand && baseHand) {
        rightHand.rotation.copy(baseHand);
      }
      restoreFingerRig(leftFingers, leftFingerRest);
      restoreFingerRig(rightFingers, rightFingerRest);
      if (head && baseHead) {
        head.rotation.copy(baseHead);
      }
    },
    update(delta) {
      elapsed += delta;
      librasElapsedMs += delta * 1000;
      if (librasFrames.length > 0) {
        const duration = librasFrames.at(-1)?.timestamp ?? 1;
        const progress = Math.min(1, duration > 0 ? librasElapsedMs / duration : 1);
        const targetIndex = Math.min(librasFrames.length - 1, Math.round(progress * (librasFrames.length - 1)));
        const frame = librasFrames[targetIndex];
        applyLibrasFrame(
          frame,
          leftArm ?? undefined,
          leftForearm ?? undefined,
          leftHand ?? undefined,
          rightArm ?? undefined,
          rightForearm ?? undefined,
          rightHand ?? undefined,
          baseLeftArm,
          baseArm,
          leftFingers,
          rightFingers,
          leftFingerRest,
          rightFingerRest,
        );
      }
      if (leftArm && baseLeftArm && librasFrames.length === 0) {
        leftArm.rotation.copy(baseLeftArm);
        if (leftForearm && baseLeftForearm) {
          leftForearm.rotation.copy(baseLeftForearm);
        }
        if (leftHand && baseLeftHand) {
          leftHand.rotation.copy(baseLeftHand);
        }
        restoreFingerRig(leftFingers, leftFingerRest);
      }
      if (rightArm && baseArm && librasFrames.length === 0) {
        rightArm.rotation.copy(baseArm);
        if (rightForearm && baseForearm) {
          rightForearm.rotation.copy(baseForearm);
        }
        if (rightHand && baseHand) {
          rightHand.rotation.copy(baseHand);
        }
        restoreFingerRig(rightFingers, rightFingerRest);
        if (activeGesture === "wave") {
          rightArm.rotation.z += 0.85 + Math.sin(elapsed * 7) * 0.28;
          if (rightForearm) {
            rightForearm.rotation.z -= 0.35 + Math.sin(elapsed * 7) * 0.18;
          }
        } else if (activeGesture === "point") {
          rightArm.rotation.z += 0.65;
        } else if (activeGesture === "listen") {
          rightArm.rotation.z += 0.16;
        }
      }
      sourceAnimationPlayer.update(delta);
      if (head && baseHead) {
        head.rotation.copy(baseHead);
        if (activeGesture === "nod") {
          head.rotation.x += Math.sin(elapsed * 5) * 0.13;
        } else if (activeGesture === "shake_head") {
          head.rotation.y += Math.sin(elapsed * 4) * 0.18;
        } else if (activeGesture === "thinking") {
          head.rotation.z += 0.12;
        }
      }
    },
  };
}

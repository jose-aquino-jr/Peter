import {
  canonicalSkeletonToLandmarkFrame,
  CANONICAL_JOINTS,
  type CanonicalJoint,
  type CanonicalSkeletonFrame,
} from "./canonical-skeleton";
import type { LandmarkChannel } from "./contracts";
import { HAND_SHAPE_TRAJECTORY_REPRESENTATION } from "./feature-vector";
import type { SignTemplate, SignTemplateRepository } from "./sign-template-repository";

interface OfflineAnimationTemplate {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly gloss: string;
  readonly frames: readonly CanonicalSkeletonFrame[];
  readonly duration: number | null;
  readonly fps: number | null;
  readonly relevantJoints: readonly CanonicalJoint[];
  readonly metadata: Readonly<Record<string, string>>;
}

const files = import.meta.glob<OfflineAnimationTemplate>(
  "../templates/libras-eqt-dual-*.template.json",
  {
    eager: true,
    import: "default",
  },
);

export class OfflineAnimationTemplateRepository implements SignTemplateRepository {
  private readonly templates: readonly SignTemplate[];

  constructor() {
    this.templates = Object.values(files)
      .filter((value) =>
        value.metadata.featureRepresentation === HAND_SHAPE_TRAJECTORY_REPRESENTATION,
      )
      .map((value) => loadTemplate(value));
  }

  async list(): Promise<readonly SignTemplate[]> {
    return this.templates;
  }

  async findByGloss(gloss: string): Promise<readonly SignTemplate[]> {
    return this.templates.filter((template) => template.gloss === gloss);
  }

  async save(_template: SignTemplate): Promise<void> {
    throw new Error("Templates de animação são somente leitura no runtime; use a ferramenta offline.");
  }

  async remove(_id: string): Promise<void> {
    throw new Error("Templates de animação são somente leitura no runtime.");
  }
}

function loadTemplate(value: OfflineAnimationTemplate): SignTemplate {
  if (
    value.version !== 1 ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    typeof value.gloss !== "string" ||
    value.gloss.trim().length === 0 ||
    !Array.isArray(value.frames) ||
    value.frames.length < 2 ||
    !Array.isArray(value.relevantJoints) ||
    !value.relevantJoints.every((joint) =>
      typeof joint === "string" && CANONICAL_JOINTS.includes(joint as CanonicalJoint),
    ) ||
    (value.duration !== null && (!Number.isFinite(value.duration) || value.duration <= 0)) ||
    (value.fps !== null && (!Number.isFinite(value.fps) || value.fps <= 0))
  ) {
    throw new Error("Arquivo de template offline inválido; esperado Canonical Skeleton v1.");
  }
  if (!value.frames.every(isCanonicalFrame)) {
    throw new Error(`Template ${value.id} contém landmarks não finitos ou malformados.`);
  }
  const frames = value.frames as readonly CanonicalSkeletonFrame[];
  const relevantJoints = value.relevantJoints as readonly CanonicalJoint[];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    if (
      (previous && frame.timestamp <= previous.timestamp) ||
      !relevantJoints.every((joint) => frame.joints[joint] !== undefined)
    ) {
      throw new Error(`Template ${value.id} não contém uma sequência temporal canônica completa.`);
    }
  }
  const landmarkSequence = frames.map((frame) => canonicalSkeletonToLandmarkFrame(frame));
  const channels = new Set<LandmarkChannel>();
  if (relevantJoints.some((joint) => joint === "head" || joint.endsWith("Shoulder") ||
    joint.endsWith("Elbow") || joint.endsWith("Wrist") || joint.endsWith("Hip") ||
    joint.endsWith("Knee") || joint.endsWith("Ankle"))) {
    channels.add("pose");
  }

  function isCanonicalFrame(value: unknown): value is CanonicalSkeletonFrame {
    if (
      typeof value !== "object" ||
      value === null ||
      !("timestamp" in value) ||
      typeof value.timestamp !== "number" ||
      !Number.isFinite(value.timestamp) ||
      !("joints" in value) ||
      typeof value.joints !== "object" ||
      value.joints === null
    ) {
      return false;
    }
    return Object.entries(value.joints).every(([joint, point]) => {
      if (!CANONICAL_JOINTS.includes(joint as CanonicalJoint)) {
        return false;
      }
      if (typeof point !== "object" || point === null) {
        return false;
      }
      return "x" in point && typeof point.x === "number" && Number.isFinite(point.x) &&
        "y" in point && typeof point.y === "number" && Number.isFinite(point.y) &&
        "z" in point && typeof point.z === "number" && Number.isFinite(point.z) &&
        (!("visibility" in point) ||
          (typeof point.visibility === "number" && Number.isFinite(point.visibility)));
    });
  }
  if (relevantJoints.some((joint) => joint.startsWith("left"))) {
    channels.add("leftHand");
  }
  if (relevantJoints.some((joint) => joint.startsWith("right"))) {
    channels.add("rightHand");
  }
  if (channels.size === 0) {
    throw new Error(`Template ${value.id} não possui articulações comparáveis.`);
  }
  return {
    id: value.id,
    name: value.name,
    gloss: value.gloss,
    landmarkSequence,
    duration: value.duration,
    relevantLandmarks: [...channels],
    canonicalSequence: frames,
    // Dataset provenance alone is not sign validation. This training sample
    // can support recognition experiments, but must not be emitted as a real
    // Libras animation without linguistic/animation review.
    validated: value.metadata.validationStatus === "validated",
    metadata: {
      ...value.metadata,
      representation: "peter-canonical-skeleton-v1",
      fps: value.fps === null ? "unknown" : String(value.fps),
      duration: value.duration === null ? "unknown" : String(value.duration),
    },
  };
}

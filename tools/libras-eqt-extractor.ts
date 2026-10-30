import type { LandmarkFrame } from "../src/vision/pipeline/contracts";
import {
  CANONICAL_JOINTS,
  canonicalSkeletonToLandmarkFrame,
  CanonicalSkeletonNormalizer,
  MediaPipeLandmarkMapper,
  type CanonicalSkeletonFrame,
} from "../src/vision/pipeline/canonical-skeleton";
import { MediapipeLandmarkExtractor } from "../src/vision/mediapipe/mediapipe-landmark-extractor";

interface VideoSample {
  readonly fileName: string;
  readonly split: "train" | "validation" | "test";
  readonly gloss: string;
  readonly informant: string;
  readonly sourceEntry: string;
}

interface VideoManifest {
  readonly sourceDataset: string;
  readonly sourceRecord: string;
  readonly sourceDoi: string;
  readonly sourceLicense: string;
  readonly attribution: string;
  readonly splitPolicy: Readonly<Record<string, string>>;
  readonly samples: readonly VideoSample[];
}

interface ExtractedSample extends VideoSample {
  readonly id: string;
  readonly duration: number;
  readonly sampleRate: number;
  readonly handCoverage: number;
  readonly shoulderCoverage: number;
  readonly frames: readonly CanonicalSkeletonFrame[];
}

const extractor = new MediapipeLandmarkExtractor();
const mapper = new MediaPipeLandmarkMapper();
const normalizer = new CanonicalSkeletonNormalizer();
const manifestInput = requiredElement<HTMLInputElement>("#manifest");
const videosInput = requiredElement<HTMLInputElement>("#videos");
const extractButton = requiredElement<HTMLButtonElement>("#extract");
const status = requiredElement<HTMLElement>("#status");

extractButton.addEventListener("click", () => {
  void extractAll();
});

async function extractAll(): Promise<void> {
  const manifestFile = manifestInput.files?.[0];
  const files = Array.from(videosInput.files ?? []);
  if (!manifestFile || files.length === 0) {
    status.textContent = "Selecione o manifesto e os vídeos RGB.";
    return;
  }

  extractButton.disabled = true;
  try {
    const manifest = JSON.parse(await manifestFile.text()) as VideoManifest;
    const filesByName = new Map(files.map((file) => [file.name, file]));
    const extracted: ExtractedSample[] = [];
    await extractor.ensureReady();

    for (let index = 0; index < manifest.samples.length; index += 1) {
      const sample = manifest.samples[index];
      const file = filesByName.get(sample.fileName);
      if (!file) {
        throw new Error(`Vídeo ausente no conjunto selecionado: ${sample.fileName}`);
      }
      status.textContent =
        `Processando ${index + 1}/${manifest.samples.length}: ${sample.fileName}`;
      extracted.push(await extractSample(file, sample));
    }

    const trainingTemplates = extracted
      .filter((sample) => sample.split === "train" && sample.gloss === "SIM")
      .map((sample) => toTemplate(sample, manifest));
    const evaluation = {
      sourceDataset: manifest.sourceDataset,
      sourceRecord: manifest.sourceRecord,
      sourceDoi: manifest.sourceDoi,
      sourceLicense: manifest.sourceLicense,
      attribution: manifest.attribution,
      splitPolicy: manifest.splitPolicy,
      representation: "hand-shape-trajectory-v1",
      validation: splitForEvaluation(extracted, "validation"),
      test: splitForEvaluation(extracted, "test"),
      extractionSummary: extracted.map(({ frames, ...sample }) => ({
        ...sample,
        frameCount: frames.length,
      })),
    };
    const response = await fetch("http://127.0.0.1:4178/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templates: trainingTemplates,
        evaluation,
      }),
    });
    if (!response.ok) {
      throw new Error(`Falha ao salvar exportação local: HTTP ${response.status}`);
    }
    status.textContent = await response.text();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    extractor.close();
    extractButton.disabled = false;
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Elemento obrigatório ausente na ferramenta: ${selector}`);
  }
  return element;
}

async function extractSample(file: File, sample: VideoSample): Promise<ExtractedSample> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const objectUrl = URL.createObjectURL(file);
  const metadataReady = waitForEvent(video, "loadedmetadata");
  const dataReady = waitForEvent(video, "loadeddata");
  video.src = objectUrl;

  try {
    await metadataReady;
    await dataReady;
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error(`${sample.fileName}: duração de vídeo inválida.`);
    }
    const sampleRate = 15;
    const sampleCount = Math.max(16, Math.ceil(video.duration * sampleRate));
    const frames: CanonicalSkeletonFrame[] = [];
    let detectedHandFrames = 0;
    let detectedShoulderFrames = 0;

    for (let frameIndex = 0; frameIndex < sampleCount; frameIndex += 1) {
      const sampleTime = (frameIndex / Math.max(sampleCount - 1, 1)) * video.duration;
      await seek(video, sampleTime);
      const raw = await extractor.extract(video);
      const canonical = normalizer.normalize(mapper.map(raw));
      const frame = fillMissingJoints({
        ...canonical,
        timestamp: frameIndex * (1000 / sampleRate),
      });
      const encoded = canonicalSkeletonToLandmarkFrame(frame);
      if (hasVisibleHand(encoded)) {
        detectedHandFrames += 1;
      }
      if (frame.joints.leftShoulder?.visibility !== 0 &&
          frame.joints.rightShoulder?.visibility !== 0) {
        detectedShoulderFrames += 1;
      }
      frames.push(frame);
    }

    const downsampled = resampleCanonicalFrames(frames, 16);
    return {
      ...sample,
      id: `${sample.split}-${sample.gloss.toLowerCase()}-${file.name.replace(/\.mp4$/i, "")}`,
      duration: video.duration,
      sampleRate,
      handCoverage: detectedHandFrames / sampleCount,
      shoulderCoverage: detectedShoulderFrames / sampleCount,
      frames: downsampled,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    video.load();
  }
}

function fillMissingJoints(frame: CanonicalSkeletonFrame): CanonicalSkeletonFrame {
  const joints = Object.fromEntries(
    CANONICAL_JOINTS.map((joint) => [
      joint,
      frame.joints[joint] ?? { x: 0, y: 0, z: 0, visibility: 0 },
    ]),
  ) as CanonicalSkeletonFrame["joints"];
  return { timestamp: frame.timestamp, joints };
}

function hasVisibleHand(frame: LandmarkFrame): boolean {
  return [frame.leftHand, frame.rightHand].some((hand) =>
    hand.some((point) => (point.visibility ?? 1) >= 0.35),
  );
}

function resampleCanonicalFrames(
  frames: readonly CanonicalSkeletonFrame[],
  maxFrames: number,
): CanonicalSkeletonFrame[] {
  if (frames.length <= maxFrames) {
    return [...frames];
  }
  return Array.from({ length: maxFrames }, (_, index) => {
    const source = Math.round((index * (frames.length - 1)) / (maxFrames - 1));
    return { ...frames[source], timestamp: index * (1000 / maxFrames) };
  });
}

function toTemplate(sample: ExtractedSample, manifest: VideoManifest) {
  return {
    version: 1,
    id: sample.id,
    name: "SIM",
    gloss: "SIM",
    frames: sample.frames,
    duration: sample.duration,
    fps: sample.sampleRate,
    relevantJoints: CANONICAL_JOINTS,
    metadata: {
      sourceDataset: manifest.sourceDataset,
      sourceRecord: manifest.sourceRecord,
      sourceDoi: manifest.sourceDoi,
      sourceEntry: sample.sourceEntry,
      sourceLicense: manifest.sourceLicense,
      attribution: manifest.attribution,
      adaptation: "Re-extracted from the licensed RGB source video with the same MediaPipe Tasks Hand/Pose landmark models and Peter Canonical Skeleton v1 mapping used by the camera pipeline.",
      representation: "peter-canonical-skeleton-v1",
      featureRepresentation: "hand-shape-trajectory-v1",
      split: sample.split,
      informant: sample.informant,
      sourceFrameRate: "unknown; uniformly sampled at 15 frames per second",
      handCoverage: sample.handCoverage.toFixed(4),
      shoulderCoverage: sample.shoulderCoverage.toFixed(4),
    },
  };
}

function splitForEvaluation(
  samples: readonly ExtractedSample[],
  split: "validation" | "test",
) {
  const selected = samples.filter((sample) => sample.split === split);
  return {
    positive: selected.filter((sample) => sample.gloss === "SIM"),
    negative: selected.filter((sample) => sample.gloss !== "SIM"),
  };
}

async function seek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.0001 && video.readyState >= 2) {
    return;
  }
  const seeked = waitForEvent(video, "seeked");
  video.currentTime = time;
  await seeked;
}

function waitForEvent(element: HTMLMediaElement, eventName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = () => reject(new Error(`Falha no vídeo durante ${eventName}.`));
    element.addEventListener(eventName, () => {
      element.removeEventListener("error", onError);
      resolve();
    }, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

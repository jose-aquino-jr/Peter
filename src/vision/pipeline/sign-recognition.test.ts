import { describe, expect, it } from "vitest";
import type { Landmark, LandmarkFrame, TemporalSequence } from "./contracts";
import { dtwSimilarity } from "./dtw";
import { ShoulderCenteredNormalizer } from "./landmark-normalizer";
import { LocalTemplateRepository, MemoryKeyValueStore } from "./local-template-repository";
import { RecognitionStabilizer } from "./recognition-stabilizer";
import { DtwSignMatchingEngine } from "./sign-matching-engine";
import type { SignTemplate } from "./sign-template-repository";
import { SlidingWindowBuffer } from "./temporal-buffer";

function point(x: number, y: number, z = 0): Landmark {
  return { x, y, z, visibility: 1 };
}

function handAt(x: number, y: number): Landmark[] {
  return Array.from({ length: 21 }, (_, index) => point(x + index * 0.002, y));
}

function bodyWithShoulders(leftX: number, rightX: number, leftY = 0.4, rightY = 0.4): Landmark[] {
  const body = Array.from({ length: 33 }, () => point(0.5, 0.5));
  body[11] = point(leftX, leftY);
  body[12] = point(rightX, rightY);
  body[15] = point(leftX, leftY + 0.2);
  body[16] = point(rightX, rightY + 0.2);
  return body;
}

function frame(timestamp: number, rightX: number, rightY: number): LandmarkFrame {
  return {
    timestamp,
    body: bodyWithShoulders(0.35, 0.65),
    face: [],
    leftHand: [],
    rightHand: handAt(rightX, rightY),
    hands: [handAt(rightX, rightY)],
  };
}

function sequenceFrom(frames: LandmarkFrame[]): TemporalSequence {
  return {
    frames,
    startedAt: frames[0]?.timestamp ?? 0,
    endedAt: frames.at(-1)?.timestamp ?? 0,
  };
}

function movingSign(start: number, stepX: number, stepY: number, count = 12): LandmarkFrame[] {
  return Array.from({ length: count }, (_, index) =>
    frame(start + index * 80, 0.6 + index * stepX, 0.55 + index * stepY),
  );
}

function templateOf(id: string, gloss: string, frames: LandmarkFrame[]): SignTemplate {
  return {
    id,
    name: gloss,
    gloss,
    landmarkSequence: frames,
    duration: ((frames.at(-1)?.timestamp ?? 0) - (frames[0]?.timestamp ?? 0)) / 1000,
    relevantLandmarks: ["rightHand", "pose"],
    metadata: { source: "test" },
  };
}

describe("shoulder-centered normalization", () => {
  it("places the shoulder midpoint at the origin and scales by shoulder width", () => {
    const normalized = new ShoulderCenteredNormalizer().normalize(frame(0, 0.8, 0.7));
    expect(normalized.body[11].x).toBeCloseTo(-0.5, 5);
    expect(normalized.body[12].x).toBeCloseTo(0.5, 5);
    expect(normalized.rightHand[0].x).toBeGreaterThan(0);
  });

  it("is invariant to camera translation and scale, including depth", () => {
    const source = frame(0, 0.8, 0.7);
    const transformed: LandmarkFrame = {
      ...source,
      body: source.body.map((item) => ({
        ...item,
        x: item.x * 1.7 + 0.13,
        y: item.y * 1.7 - 0.08,
        z: item.z * 1.7 + 0.4,
      })),
      rightHand: source.rightHand.map((item) => ({
        ...item,
        x: item.x * 1.7 + 0.13,
        y: item.y * 1.7 - 0.08,
        z: item.z * 1.7 + 0.4,
      })),
    };
    const normalizer = new ShoulderCenteredNormalizer();
    const normalized = normalizer.normalize(source);
    const normalizedTransformed = normalizer.normalize(transformed);

    expect(normalizedTransformed.rightHand[0].x).toBeCloseTo(normalized.rightHand[0].x, 5);
    expect(normalizedTransformed.rightHand[0].y).toBeCloseTo(normalized.rightHand[0].y, 5);
    expect(normalizedTransformed.rightHand[0].z).toBeCloseTo(normalized.rightHand[0].z, 5);
  });
});

describe("sliding window buffer", () => {
  it("keeps only frames inside the duration window", () => {
    const buffer = new SlidingWindowBuffer(200);
    buffer.append(frame(0, 0.6, 0.5));
    buffer.append(frame(120, 0.61, 0.5));
    const snapshot = buffer.append(frame(250, 0.62, 0.5));
    expect(snapshot.frames).toHaveLength(2);
    expect(snapshot.frames[0].timestamp).toBe(120);
  });
});

describe("DTW similarity", () => {
  it("scores identical sequences near 1 even when lengths differ", () => {
    const short = movingSign(0, 0.01, -0.012, 8).map((item) => [item.rightHand[0].x, item.rightHand[0].y]);
    const long = movingSign(0, 0.01, -0.012, 20).map((item) => [item.rightHand[0].x, item.rightHand[0].y]);
    expect(dtwSimilarity(short, short)).toBeGreaterThan(0.99);
    expect(dtwSimilarity(short, long)).toBeGreaterThan(0.85);
  });

  it("scores unrelated trajectories lower", () => {
    const thanks = movingSign(0, 0.01, -0.02, 10).map((item) => [item.rightHand[0].x, item.rightHand[0].y]);
    const wave = movingSign(0, 0.03, 0.002, 10).map((item) => [
      item.rightHand[0].x + Math.sin(item.timestamp) * 0.08,
      item.rightHand[0].y,
    ]);
    expect(dtwSimilarity(thanks, wave)).toBeLessThan(dtwSimilarity(thanks, thanks));
  });
});

describe("sign matching engine", () => {
  it("returns the closest gloss above threshold and NO_MATCH otherwise", () => {
    const engine = new DtwSignMatchingEngine(0.95, 3, 0.001, 0.28, 16, 0.05);
    engine.setTemplates([
      templateOf("obrigado-1", "OBRIGADO", movingSign(0, 0.008, -0.015)),
      templateOf("tchau-1", "TCHAU", movingSign(0, 0.02, 0.001)),
    ]);

    const match = engine.match(sequenceFrom(movingSign(40, 0.008, -0.015, 10)));
    expect(match.status).toBe("match");
    expect(match.best?.gloss).toBe("OBRIGADO");
    expect(match.candidates[0]?.confidence).toBeGreaterThan(match.candidates[1]?.confidence ?? 0);

    const idle = engine.match(sequenceFrom([
      frame(0, 0.6, 0.55),
      frame(80, 0.6001, 0.5501),
      frame(160, 0.6, 0.55),
    ]));
    expect(idle.status).toBe("no_match");

    engine.setTemplates([templateOf("oi-1", "OI", movingSign(0, -0.02, 0.02))]);
    const unknown = engine.match(sequenceFrom(movingSign(0, 0.008, -0.015, 10)));
    expect(unknown.status).toBe("no_match");
  });

  it("matches a camera sequence for OBRIGADO against a slower recorded template", () => {
    const normalizer = new ShoulderCenteredNormalizer();
    const templateFrames = movingSign(0, 0.008, -0.015).map((item) =>
      normalizer.normalize(item),
    );
    const template = templateOf("obrigado-local-1", "OBRIGADO", templateFrames);
    const engine = new DtwSignMatchingEngine(0.68, 3, 0.001);
    engine.setTemplates([template]);

    const buffer = new SlidingWindowBuffer(5000);
    const userFrames = movingSign(1000, 0.008 * 11 / 17, -0.015 * 11 / 17, 18);
    for (const item of userFrames) {
      buffer.append(normalizer.normalize(item));
    }
    const match = engine.match(buffer.snapshot());

    expect(match.status).toBe("match");
    expect(match.best?.gloss).toBe("OBRIGADO");
    expect(match.best?.confidence).toBeGreaterThan(0.9);

    const idle = sequenceFrom(
      Array.from({ length: 12 }, (_, index) => normalizer.normalize(frame(index * 80, 0.6, 0.55))),
    );
    expect(engine.match(idle).status).toBe("no_match");
  });

  it("returns NO_MATCH when the top two signs have indistinguishable scores", () => {
    const engine = new DtwSignMatchingEngine(0.5, 3, 0.001, 0.28, 16, 0.08);
    const sequence = movingSign(0, 0.008, -0.015);
    engine.setTemplates([
      templateOf("obrigado-1", "OBRIGADO", sequence),
      templateOf("desculpa-1", "DESCULPA", sequence),
    ]);

    const result = engine.match(sequenceFrom(sequence));

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].confidence - result.candidates[1].confidence).toBeLessThan(0.08);
    expect(result.status).toBe("no_match");
  });

  it("returns NO_MATCH for a high-energy irregular hand trajectory", () => {
    const normalizer = new ShoulderCenteredNormalizer();
    const engine = new DtwSignMatchingEngine(0.68, 3, 0.001);
    engine.setTemplates([
      templateOf("obrigado-reference", "OBRIGADO", movingSign(0, 0.008, -0.015)),
    ]);
    const irregular = Array.from({ length: 12 }, (_, index) => {
      const x = index % 2 === 0 ? -1.4 : 1.7;
      const y = index % 3 === 0 ? 1.5 : -1.2;
      return normalizer.normalize(frame(index * 80, x, y));
    });

    expect(engine.match(sequenceFrom(irregular)).status).toBe("no_match");
  });

  it("reports separate shape/trajectory scores and the motion-gate rejection", () => {
    const reference = movingSign(0, 0.008, -0.015);
    const engine = new DtwSignMatchingEngine(0.5, 3, 1);
    engine.setTemplates([templateOf("sim-reference", "SIM", reference)]);

    const diagnostic = engine.diagnose(sequenceFrom(reference));
    expect(diagnostic.rejectionReason).toBe("motion_gate");
    expect(diagnostic.motionGatePassed).toBe(false);
    expect(diagnostic.templateScores[0]?.handShapeScore).toBeCloseTo(1, 5);
    expect(diagnostic.templateScores[0]?.handTrajectoryScore).toBeCloseTo(1, 5);
    expect(diagnostic.templateScores[0]?.combinedScore).toBeCloseTo(1, 5);
  });
});

describe("recognition stabilizer", () => {
  it("emits once per gesture and rearms only after the match is released", () => {
    const stabilizer = new RecognitionStabilizer(3, 1000, 0.5);
    const hit = {
      status: "match" as const,
      candidates: [{ sign: "OBRIGADO", gloss: "OBRIGADO", confidence: 0.9 }],
      best: { sign: "OBRIGADO", gloss: "OBRIGADO", confidence: 0.9 },
    };

    expect(stabilizer.observe(hit, 0)).toBeUndefined();
    expect(stabilizer.observe(hit, 100)).toBeUndefined();
    expect(stabilizer.observe(hit, 200)?.gloss).toBe("OBRIGADO");
    expect(stabilizer.observe(hit, 300)).toBeUndefined();
    expect(stabilizer.observe(hit, 1400)).toBeUndefined();
    expect(stabilizer.observe(hit, 1500)).toBeUndefined();
    expect(stabilizer.observe(hit, 1600)).toBeUndefined();
    expect(stabilizer.observe({ status: "no_match", candidates: [] }, 1700)).toBeUndefined();
    expect(stabilizer.observe(hit, 1800)).toBeUndefined();
    expect(stabilizer.observe(hit, 1900)).toBeUndefined();
    expect(stabilizer.observe(hit, 2000)?.gloss).toBe("OBRIGADO");
  });
});

describe("local template repository", () => {
  it("stores multiple templates for the same gloss", async () => {
    const repository = new LocalTemplateRepository(new MemoryKeyValueStore());
    await repository.save(templateOf("obrigado-1", "OBRIGADO", movingSign(0, 0.01, -0.01)));
    await repository.save(templateOf("obrigado-2", "OBRIGADO", movingSign(0, 0.012, -0.011)));
    const listed = await repository.findByGloss("OBRIGADO");
    expect(listed).toHaveLength(2);
    await repository.remove("obrigado-1");
    expect(await repository.list()).toHaveLength(1);
  });
});

import { peterConfig } from "../../core/config";
import type { SignMatchResult, SignRecognitionCandidate } from "./contracts";

export class RecognitionStabilizer {
  private pendingGloss: string | undefined;
  private hits = 0;
  private cooldownUntil = 0;
  private lastEmittedGloss: string | undefined;
  private latched = false;

  constructor(
    private readonly consecutiveHits: number = peterConfig.vision.consecutiveHits,
    private readonly cooldownMs: number = peterConfig.vision.cooldownMs,
    private readonly releaseConfidence: number = peterConfig.vision.releaseConfidence,
  ) {}

  observe(result: SignMatchResult, now = Date.now()): SignRecognitionCandidate | undefined {
    const best = result.best;
    const released =
      result.status !== "match" || !best || best.confidence < this.releaseConfidence;

    if (this.latched) {
      if (released) {
        this.latched = false;
        this.pendingGloss = undefined;
        this.hits = 0;
      }
      return undefined;
    }

    if (now < this.cooldownUntil) {
      if (released) {
        this.cooldownUntil = 0;
      } else {
        return undefined;
      }
    }

    if (result.status !== "match" || !best) {
      this.pendingGloss = undefined;
      this.hits = 0;
      return undefined;
    }

    if (this.pendingGloss === best.gloss) {
      this.hits += 1;
    } else {
      this.pendingGloss = best.gloss;
      this.hits = 1;
    }

    if (this.hits < this.consecutiveHits) {
      return undefined;
    }

    this.hits = 0;
    this.pendingGloss = undefined;
    this.latched = true;
    this.lastEmittedGloss = best.gloss;
    this.cooldownUntil = now + this.cooldownMs;
    return best;
  }

  reset(): void {
    this.pendingGloss = undefined;
    this.hits = 0;
    this.cooldownUntil = 0;
    this.lastEmittedGloss = undefined;
    this.latched = false;
  }

  get lastEmitted(): string | undefined {
    return this.lastEmittedGloss;
  }
}

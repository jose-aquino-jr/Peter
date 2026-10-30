import type { LandmarkChannel, LandmarkFrame } from "./contracts";

export interface SignTemplate {
  readonly id: string;
  readonly name: string;
  readonly gloss: string;
  readonly landmarkSequence: readonly LandmarkFrame[];
  readonly duration: number | null;
  readonly relevantLandmarks: readonly LandmarkChannel[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly canonicalSequence?: readonly import("./canonical-skeleton").CanonicalSkeletonFrame[];
  readonly validated?: boolean;
}

export interface SignTemplateRepository {
  list(): Promise<readonly SignTemplate[]>;
  findByGloss(gloss: string): Promise<readonly SignTemplate[]>;
  save(template: SignTemplate): Promise<void>;
  remove(id: string): Promise<void>;
}

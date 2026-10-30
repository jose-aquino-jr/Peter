import type { LandmarkFrame, TemporalSequence, TemporalSequenceBuilder } from "./contracts";

export class SlidingWindowBuffer implements TemporalSequenceBuilder {
  private readonly frames: LandmarkFrame[] = [];

  constructor(private readonly durationMs: number) {}

  append(frame: LandmarkFrame): TemporalSequence {
    this.frames.push(frame);
    const cutoff = frame.timestamp - this.durationMs;
    while (this.frames.length > 0 && this.frames[0].timestamp < cutoff) {
      this.frames.shift();
    }
    return this.snapshot();
  }

  snapshot(): TemporalSequence {
    const frames = [...this.frames];
    return {
      frames,
      startedAt: frames[0]?.timestamp ?? 0,
      endedAt: frames.at(-1)?.timestamp ?? 0,
    };
  }

  reset(): void {
    this.frames.length = 0;
  }

  get size(): number {
    return this.frames.length;
  }
}

export function cloneSequence(sequence: TemporalSequence): TemporalSequence {
  return {
    frames: sequence.frames.map((frame) => ({ ...frame })),
    startedAt: sequence.startedAt,
    endedAt: sequence.endedAt,
  };
}

import type { EventBus } from "../core/event-bus";
import { peterConfig } from "../core/config";
import { logger } from "../core/logger";
import type { VisionEngine } from "./vision-engine";

export class MockVisionEngine implements VisionEngine {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly events: EventBus,
    private readonly intervalMs = peterConfig.mockVisionIntervalMs,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    logger.info("vision", "Mock recognition started");
    this.timer = setInterval(() => this.simulateOnce(), this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
    logger.info("vision", "Mock recognition stopped");
  }

  simulateOnce(): void {
    this.events.emit({
      type: "vision.sign-recognized",
      recognition: {
        sign: "OBRIGADO",
        gloss: "OBRIGADO",
        confidence: 0.91,
        timestamp: Date.now(),
      },
    });
  }
}

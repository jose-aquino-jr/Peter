import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "./event-bus";

describe("InMemoryEventBus", () => {
  it("delivers only matching event types and supports unsubscribe", () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on("vision.sign-recognized", handler);

    bus.emit({
      type: "vision.sign-recognized",
      recognition: {
        sign: "OBRIGADO",
        gloss: "OBRIGADO",
        confidence: 0.91,
        timestamp: 123,
      },
    });
    bus.emit({ type: "voice.status", status: "idle", message: "ready" });
    unsubscribe();
    bus.emit({
      type: "vision.sign-recognized",
      recognition: {
        sign: "OLÁ",
        gloss: "OLÁ",
        confidence: 0.95,
        timestamp: 456,
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].recognition.gloss).toBe("OBRIGADO");
  });
});

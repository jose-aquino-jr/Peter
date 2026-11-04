import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "./event-bus";

const assistantResponse = {
  text: "Olá! Eu sou o Peter. Como posso ajudar?",
  source: "mock",
  intent: "greeting",
  emotion: "happy",
  gesture: "wave",
  inReplyTo: { type: "transcription", text: "Olá", timestamp: 1 },
} as const;

describe("InMemoryEventBus delivery", () => {
  it("notifies every handler registered for the same event type", () => {
    const bus = new InMemoryEventBus();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = bus.on("voice.status", first);
    const offSecond = bus.on("voice.status", second);

    bus.emit({ type: "voice.status", status: "idle", message: "Pronto" });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
  });

  it("delivers duplicated events to subscribed handlers", () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const off = bus.on("brain.response", handler);

    bus.emit({ type: "brain.response", response: assistantResponse });
    bus.emit({ type: "brain.response", response: assistantResponse });

    expect(handler).toHaveBeenCalledTimes(2);
    off();
  });

  it("delivers events to handlers in subscription order", () => {
    const bus = new InMemoryEventBus();
    const order: string[] = [];
    const offFirst = bus.on("vision.camera-status", () => order.push("first"));
    const offSecond = bus.on("vision.camera-status", () => order.push("second"));

    bus.emit({ type: "vision.camera-status", status: "idle", message: "Aguardando" });

    expect(order).toEqual(["first", "second"]);
    offFirst();
    offSecond();
  });
});

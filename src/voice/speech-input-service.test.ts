import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../core/event-bus";
import type { TranscriptionCallbacks, TranscriptionProvider } from "./speech-to-text-engine";
import { SpeechInputService } from "./speech-input-service";

class FakeTranscriptionProvider implements TranscriptionProvider {
  readonly supported = true;
  callbacks: TranscriptionCallbacks | undefined;
  start = vi.fn(async (callbacks: TranscriptionCallbacks) => { this.callbacks = callbacks; });
  stop = vi.fn(() => this.callbacks?.onEnd());
}

describe("SpeechInputService", () => {
  it("starts and stops the provider and publishes the microphone state", async () => {
    const events = new InMemoryEventBus();
    const provider = new FakeTranscriptionProvider();
    const service = new SpeechInputService(events, provider);
    const microphone: boolean[] = [];
    events.on("voice.microphone-status", ({ enabled }) => microphone.push(enabled));

    await service.start();
    expect(service.listening).toBe(true);
    expect(microphone).toEqual([true]);
    service.stop();
    expect(provider.stop).toHaveBeenCalledOnce();
    expect(service.listening).toBe(false);
    expect(microphone).toEqual([true, false]);
  });

  it("publishes interim text and sends only final text to the Brain input event", async () => {
    const events = new InMemoryEventBus();
    const provider = new FakeTranscriptionProvider();
    const service = new SpeechInputService(events, provider);
    const interim: string[] = [];
    const final: string[] = [];
    events.on("voice.transcription-interim", ({ text }) => interim.push(text));
    events.on("voice.transcription", ({ text }) => final.push(text));

    await service.start();
    provider.callbacks?.onInterimResult("Olá, Pe");
    provider.callbacks?.onFinalResult("Olá, Peter");
    provider.callbacks?.onEnd();

    expect(interim).toEqual(["Olá, Pe", ""]);
    expect(final).toEqual(["Olá, Peter"]);
    expect(service.listening).toBe(false);
  });
});

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

describe("SpeechInputService transcript finalization", () => {
  it("ignores transcripts that are empty after trimming and reports idle when nothing was heard", async () => {
    const events = new InMemoryEventBus();
    const finals: string[] = [];
    const transcriptionStates: string[] = [];
    events.on("voice.transcription", ({ text }) => finals.push(text));
    events.on("voice.transcription-status", ({ status }) => transcriptionStates.push(status));
    const provider = new FakeTranscriptionProvider();
    const service = new SpeechInputService(events, provider);

    await service.start();
    provider.callbacks?.onInterimResult("Olá, P");
    provider.callbacks?.onFinalResult("   ");
    provider.callbacks?.onEnd();

    expect(finals).toEqual([]);
    expect(transcriptionStates).toEqual(["listening", "transcribing", "idle"]);
    expect(service.listening).toBe(false);
  });

  it("does not report an idle fallback after a final transcript was accepted", async () => {
    const events = new InMemoryEventBus();
    const finals: string[] = [];
    const microphoneStates: boolean[] = [];
    const transcriptionStates: string[] = [];
    events.on("voice.transcription", ({ text }) => finals.push(text));
    events.on("voice.microphone-status", ({ enabled }) => microphoneStates.push(enabled));
    events.on("voice.transcription-status", ({ status }) => transcriptionStates.push(status));
    const provider = new FakeTranscriptionProvider();
    const service = new SpeechInputService(events, provider);

    await service.start();
    provider.callbacks?.onInterimResult("Olá, Pe");
    provider.callbacks?.onFinalResult("Olá, Peter");
    provider.callbacks?.onEnd();

    expect(finals).toEqual(["Olá, Peter"]);
    expect(transcriptionStates).toEqual(["listening", "transcribing"]);
    expect(microphoneStates).toEqual([true, false]);
    expect(service.listening).toBe(false);
  });
});

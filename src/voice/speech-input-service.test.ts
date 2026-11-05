import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../core/event-bus";
import type { TranscriptionCallbacks, TranscriptionProvider } from "./speech-to-text-engine";
import { NO_SPEECH_MESSAGE_PREFIX } from "./speech-to-text-engine";
import { SpeechInputService } from "./speech-input-service";

class FakeTranscriptionProvider implements TranscriptionProvider {
  readonly supported = true;
  callbacks: TranscriptionCallbacks | undefined;
  start = vi.fn(async (callbacks: TranscriptionCallbacks) => { this.callbacks = callbacks; });
  stop = vi.fn(() => this.callbacks?.onEnd());
}

interface StatusEvent {
  readonly status: string;
  readonly message?: string;
}

function setup() {
  const events = new InMemoryEventBus();
  const provider = new FakeTranscriptionProvider();
  const service = new SpeechInputService(events, provider);
  const microphone: boolean[] = [];
  const statuses: StatusEvent[] = [];
  events.on("voice.microphone-status", ({ enabled }) => microphone.push(enabled));
  events.on("voice.transcription-status", ({ status, message }) => statuses.push({ status, message }));
  return { events, provider, service, microphone, statuses };
}

describe("SpeechInputService", () => {
  it("starts and stops the provider and publishes the microphone state", async () => {
    const { provider, service, microphone } = setup();

    await service.start();
    expect(service.listening).toBe(true);
    expect(microphone).toEqual([true]);
    service.stop();
    expect(provider.stop).toHaveBeenCalledOnce();
    expect(service.listening).toBe(false);
    expect(microphone).toEqual([true, false]);
  });

  it("publishes interim text and sends only final text to the Brain input event", async () => {
    const { events, provider, service } = setup();
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

  it("ignores a second start while a session is already active", async () => {
    const { provider, service } = setup();
    await service.start();
    await service.start();
    expect(provider.start).toHaveBeenCalledOnce();
  });

  it("treats no-speech results as idle instead of an error", async () => {
    const { provider, service, microphone, statuses } = setup();

    await service.start();
    provider.callbacks?.onError(new Error(`${NO_SPEECH_MESSAGE_PREFIX} nesse áudio. Tente falar mais perto do microfone.`));
    provider.callbacks?.onEnd();

    expect(statuses).toEqual([
      { status: "listening", message: "Ouvindo..." },
      { status: "idle", message: "Não ouvi fala. Toque no microfone para tentar novamente." },
    ]);
    expect(microphone).toEqual([true, false]);
    expect(service.listening).toBe(false);
  });

  it("reports provider failures once as an error without the idle fallback message", async () => {
    const { provider, service, microphone, statuses } = setup();

    await service.start();
    provider.callbacks?.onError(new Error("Não foi possível acessar o serviço local de transcrição."));
    provider.callbacks?.onEnd();

    expect(microphone).toEqual([true, false]);
    expect(statuses).toEqual([
      { status: "listening", message: "Ouvindo..." },
      { status: "error", message: "Não foi possível acessar o serviço local de transcrição." },
    ]);
    expect(statuses.some((event) => event.status === "idle")).toBe(false);
    expect(service.listening).toBe(false);
  });

  it("fails gracefully when the provider cannot start", async () => {
    const { provider, service, microphone, statuses } = setup();
    const failure = new Error("Permita o acesso ao microfone nas configurações do navegador.");
    provider.start = vi.fn(async () => { throw failure; });

    await service.start();

    expect(service.listening).toBe(false);
    expect(microphone).toEqual([false]);
    expect(statuses).toEqual([
      { status: "listening", message: "Ouvindo..." },
      { status: "error", message: failure.message },
    ]);
  });

  it("honors stop() requested while the provider is still starting", async () => {
    const { provider, service, microphone } = setup();
    let releaseStart: () => void = () => {};
    provider.start = vi.fn(async (callbacks: TranscriptionCallbacks) => {
      await new Promise<void>((resolve) => { releaseStart = resolve; });
      provider.callbacks = callbacks;
    });

    const startPromise = service.start();
    service.stop(); // provider.start() has not settled yet
    releaseStart();
    await startPromise;

    expect(provider.stop).toHaveBeenCalledOnce();
    expect(service.listening).toBe(false);
    // The capture never became active from the UI's point of view, so the state stays coherent.
    expect(microphone).toEqual([]);
  });

  it("stops the provider only once when stop is invoked repeatedly", async () => {
    const { provider, service } = setup();

    await service.start();
    service.stop();
    service.stop();

    expect(provider.stop).toHaveBeenCalledOnce();
    expect(service.listening).toBe(false);
  });
});

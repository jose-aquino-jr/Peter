import { describe, expect, it, vi } from "vitest";
import { VrmAvatarController } from "../avatar/vrm-avatar-controller";
import { MockBrainEngine } from "../brain/mock-brain-engine";
import { MockLanguageModel } from "../brain/mock-language-model";
import { ResponseController } from "../response/response-controller";
import { EventDrivenBrainEngine } from "../brain/event-driven-brain-engine";
import { FallbackRuleProvider } from "../brain/fallback-rule-provider";
import { InMemoryEventBus } from "./event-bus";
import { MockVisionEngine } from "../vision/mock-vision-engine";
import { MockVoiceEngine } from "../voice/mock-voice-engine";
import { SpeechInputService } from "../voice/speech-input-service";
import type { TranscriptionCallbacks, TranscriptionProvider } from "../voice/speech-to-text-engine";

class PipelineTranscriptionProvider implements TranscriptionProvider {
  readonly supported = true;
  callbacks: TranscriptionCallbacks | undefined;
  async start(callbacks: TranscriptionCallbacks): Promise<void> { this.callbacks = callbacks; }
  stop(): void { this.callbacks?.onEnd(); }
}

describe("mock communication pipeline", () => {
  it("routes a recognized sign through Brain to Avatar and Voice using events", async () => {
    const events = new InMemoryEventBus();
    const vision = new MockVisionEngine(events);
    const brain = new MockBrainEngine(events, new MockLanguageModel());
    const voice = new MockVoiceEngine(events);
    const avatar = new VrmAvatarController(events);
    const playLibrasSequence = vi.spyOn(avatar, "playLibrasSequence");
    const responseController = new ResponseController(events, voice, avatar);
    const observed: string[] = [];
    let performedGesture: string | undefined;

    events.on("vision.sign-recognized", () => observed.push("vision"));
    events.on("brain.response", () => observed.push("brain"));
    events.on("avatar.command", ({ command }) => {
      observed.push(`avatar:${command.type}`);
      if (command.type === "gesture") {
        performedGesture = command.gesture;
      }
    });
    events.on("voice.status", () => observed.push("voice"));

    brain.start();
    voice.start();
    avatar.start();
    responseController.start();
    observed.length = 0;

    vision.simulateOnce();

    await vi.waitFor(() => expect(observed).toContain("voice"));
    expect(observed).toEqual([
      "vision",
      "brain",
      "avatar:emotion",
      "voice",
    ]);
    expect(performedGesture).toBeUndefined();
    expect(playLibrasSequence).not.toHaveBeenCalled();

    avatar.stop();
    responseController.stop();
    brain.stop();
    voice.stop();
    vision.stop();
  });

  it("routes a future voice transcription through Brain to Avatar", async () => {
    const events = new InMemoryEventBus();
    const brain = new MockBrainEngine(events, new MockLanguageModel());
    const voice = new MockVoiceEngine(events);
    const avatar = new VrmAvatarController(events);
    const responseController = new ResponseController(events, voice, avatar);
    const observed: string[] = [];

    events.on("brain.response", ({ response }) => {
      observed.push(`brain:${response.inReplyTo.type}`);
    });
    events.on("avatar.command", ({ command }) => observed.push(`avatar:${command.type}`));

    brain.start();
    voice.start();
    avatar.start();
    responseController.start();
    observed.length = 0;

    events.emit({
      type: "voice.transcription",
      text: "Preciso de ajuda",
      timestamp: 123,
    });

    await vi.waitFor(() => expect(observed).toContain("avatar:emotion"));
    expect(observed).toEqual([
      "brain:transcription",
      "avatar:emotion",
    ]);

    avatar.stop();
    responseController.stop();
    brain.stop();
    voice.stop();
  });

  it("routes mock speech through transcript, local failure, rules fallback, response, and voice", async () => {
    const events = new InMemoryEventBus();
    const speechProvider = new PipelineTranscriptionProvider();
    const speechInput = new SpeechInputService(events, speechProvider);
    const localProvider = { generateResponse: vi.fn().mockRejectedValue(new Error("Ollama offline")) };
    const brain = new EventDrivenBrainEngine(events, localProvider, new FallbackRuleProvider());
    const voice = new MockVoiceEngine(events);
    const speak = vi.spyOn(voice, "speak");
    const avatar = new VrmAvatarController(events);
    const responseController = new ResponseController(events, voice, avatar);
    const responseReady = new Promise<void>((resolve) => {
      events.on("response.ready", ({ response }) => {
        expect(response.source).toBe("rules");
        expect(response.inReplyTo.type).toBe("transcription");
        expect(response.text).toContain("Olá!");
        resolve();
      });
    });

    brain.start();
    voice.start();
    responseController.start();
    await speechInput.start();
    speechProvider.callbacks?.onInterimResult("Oi, Pe");
    speechProvider.callbacks?.onFinalResult("Oi, Peter");
    speechProvider.callbacks?.onEnd();

    await responseReady;
    expect(localProvider.generateResponse).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledWith("Olá! Eu sou o Peter. Como posso ajudar?");
    expect(brain.getConversation().map((message) => message.text)).toEqual([
      "Oi, Peter",
      "Olá! Eu sou o Peter. Como posso ajudar?",
    ]);
    speechInput.stop();
    responseController.stop();
    brain.stop();
    voice.stop();
  });
});

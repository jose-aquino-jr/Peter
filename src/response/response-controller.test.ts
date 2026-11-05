import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../core/event-bus";
import type { AssistantResponse } from "../core/messages";
import { VrmAvatarController } from "../avatar/vrm-avatar-controller";
import { ResponseController } from "./response-controller";
import type { TextToSpeechEngine } from "../voice/text-to-speech-engine";

function createAssistantResponse(): AssistantResponse {
  return {
    text: "Olá! Eu sou o Peter. Como posso ajudar?",
    source: "rules",
    intent: "greeting",
    emotion: "happy",
    gesture: "wave",
    inReplyTo: { type: "transcription", text: "Olá", timestamp: 5 },
  };
}

describe("ResponseController", () => {
  it("speaks the assistant response and publishes response ready", async () => {
    const events = new InMemoryEventBus();
    const speak = vi.fn().mockResolvedValue(undefined);
    const voice = { speak } as unknown as TextToSpeechEngine;
    const avatar = new VrmAvatarController(events);
    const controller = new ResponseController(events, voice, avatar);
    const states: string[] = [];
    events.on("conversation.state", ({ state }) => states.push(state));
    const responseReady = new Promise<AssistantResponse>((resolve) => {
      events.on("response.ready", ({ response }) => resolve(response));
    });

    controller.start();
    events.emit({ type: "brain.response", response: createAssistantResponse() });
    const event = await responseReady;
    expect(speak).toHaveBeenCalledWith(event.text);
    expect(states).toContain("responding");
    controller.stop();

    events.emit({ type: "brain.response", response: createAssistantResponse() });
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
  });

  it("emits a core error when speech synthesis fails", async () => {
    const events = new InMemoryEventBus();
    const speak = vi.fn().mockRejectedValue(new Error("Síntese de voz falhou."));
    const voice = { speak } as unknown as TextToSpeechEngine;
    const avatar = new VrmAvatarController(events);
    const controller = new ResponseController(events, voice, avatar);
    const coreErrors: Array<{ source: string; message: string }> = [];
    events.on("core.error", (event) => coreErrors.push(event));
    const responseReady = new Promise<AssistantResponse>((resolve) => {
      events.on("response.ready", ({ response }) => resolve(response));
    });

    controller.start();
    events.emit({ type: "brain.response", response: createAssistantResponse() });
    await responseReady;
    await vi.waitFor(() => expect(coreErrors).toHaveLength(1));

    expect(coreErrors[0]?.source).toBe("voice");
    expect(coreErrors[0]?.message).toContain("Síntese de voz falhou");
    controller.stop();
  });
});

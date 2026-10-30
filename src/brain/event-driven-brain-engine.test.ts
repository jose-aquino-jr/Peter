import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../core/event-bus";
import type { LanguageModel } from "./language-model";
import { EventDrivenBrainEngine } from "./event-driven-brain-engine";

describe("EventDrivenBrainEngine", () => {
  it("uses the model for a phrase without a matching rule", async () => {
    const events = new InMemoryEventBus();
    const model: LanguageModel = {
      generateResponse: vi.fn().mockResolvedValue({
        text: "Uma resposta gerada localmente.",
        source: "local-llm",
        intent: "conversation",
        emotion: "neutral",
        gesture: "nod",
      }),
    };
    const brain = new EventDrivenBrainEngine(events, model);
    const response = new Promise<void>((resolve) => {
      events.on("brain.response", ({ response: result }) => {
        expect(result.text).toBe("Uma resposta gerada localmente.");
        expect(result.gesture).toBe("nod");
        expect(result.inReplyTo.type).toBe("transcription");
        resolve();
      });
    });
    brain.start();
    events.emit({
      type: "voice.transcription",
      text: "Explique inteligência artificial",
      timestamp: 123,
    });

    await response;
    expect(model.generateResponse).toHaveBeenCalledOnce();
    expect(brain.getConversation().map((message) => message.text)).toEqual([
      "Explique inteligência artificial",
      "Uma resposta gerada localmente.",
    ]);
    brain.stop();
  });

  it("tries the local provider first, then uses rules if Ollama fails", async () => {
    const events = new InMemoryEventBus();
    const model: LanguageModel = {
      generateResponse: vi.fn().mockRejectedValue(new Error("Ollama indisponível")),
    };
    const brain = new EventDrivenBrainEngine(events, model);
    const answer = new Promise<void>((resolve) => {
      events.on("brain.response", ({ response }) => {
        expect(response.text).toBe("De nada! Estou aqui para ajudar.");
        expect(response.source).toBe("rules");
        expect(response.intent).toBe("acknowledge");
        expect(response.inReplyTo.type).toBe("sign");
        resolve();
      });
    });
    brain.start();
    events.emit({
      type: "vision.sign-recognized",
      recognition: {
        sign: "obrigado",
        gloss: "OBRIGADO",
        confidence: 0.91,
        timestamp: 789,
      },
    });

    await answer;
    expect(model.generateResponse).toHaveBeenCalledOnce();
    brain.stop();
  });

  it("uses a deterministic fallback and keeps both turns in session memory when local Ollama is unavailable", async () => {
    const events = new InMemoryEventBus();
    const brain = new EventDrivenBrainEngine(events, {
      generateResponse: vi.fn().mockRejectedValue(new Error("Ollama indisponível")),
    });
    const fallbackResponse = new Promise<void>((resolve) => {
      events.on("brain.response", ({ response }) => {
        expect(response.source).toBe("rules");
        expect(response.text).toContain("Ainda estou aprendendo");
        resolve();
      });
    });
    brain.start();
    events.emit({
      type: "voice.transcription",
      text: "Explique algo difícil",
      timestamp: 456,
    });

    await fallbackResponse;
    expect(brain.getConversation()).toHaveLength(2);
    brain.stop();
    expect(brain.getConversation()).toHaveLength(0);
  });

  it("passes earlier user and Peter turns to the next local provider call", async () => {
    const events = new InMemoryEventBus();
    const model: LanguageModel = {
      generateResponse: vi.fn().mockResolvedValue({
        text: "Estou bem.", source: "local-llm", intent: "conversation", emotion: "neutral", gesture: "nod",
      }),
    };
    const brain = new EventDrivenBrainEngine(events, model);
    const responses: string[] = [];
    const finished = new Promise<void>((resolve) => {
      events.on("brain.response", ({ response }) => {
        responses.push(response.text);
        if (responses.length === 2) resolve();
      });
    });
    brain.start();
    events.emit({ type: "voice.transcription", text: "Oi", timestamp: 1 });
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    events.emit({ type: "voice.transcription", text: "Tudo bem?", timestamp: 2 });
    await finished;

    const secondContext = (model.generateResponse as ReturnType<typeof vi.fn>).mock.calls[1][1];
    expect(secondContext.map((message: { text: string }) => message.text)).toEqual([
      "Oi", "Estou bem.", "Tudo bem?",
    ]);
    brain.stop();
  });
});

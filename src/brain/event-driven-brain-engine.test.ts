import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../core/event-bus";
import type { AssistantInput } from "../core/messages";
import type { LanguageModel, LanguageModelReply } from "./language-model";
import { EventDrivenBrainEngine } from "./event-driven-brain-engine";

function reply(text: string): LanguageModelReply {
  return {
    text,
    source: "local-llm",
    intent: "conversation",
    emotion: "neutral",
    gesture: "nod",
  };
}

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

  it("serializes turns so a second request starts only after the first finishes", async () => {
    const events = new InMemoryEventBus();
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const called: string[] = [];
    const model: LanguageModel = {
      generateResponse: vi.fn(async (input: AssistantInput): Promise<LanguageModelReply> => {
        const text = input.type === "sign" ? input.recognition.gloss : input.text;
        called.push(text);
        if (text === "primeira") {
          await firstGate;
        }
        return reply(`resposta ${text}`);
      }),
    };
    const responses: string[] = [];
    events.on("brain.response", ({ response }) => responses.push(response.text));
    const brain = new EventDrivenBrainEngine(events, model);
    brain.start();

    events.emit({ type: "voice.transcription", text: "primeira", timestamp: 1 });
    await vi.waitFor(() => expect(called).toEqual(["primeira"]));

    events.emit({ type: "voice.transcription", text: "segunda", timestamp: 2 });
    await Promise.resolve();
    expect(called).toEqual(["primeira"]);

    releaseFirst();
    await vi.waitFor(() =>
      expect(responses).toEqual(["resposta primeira", "resposta segunda"]),
    );
    expect(called).toEqual(["primeira", "segunda"]);
    expect(brain.getConversation().map((message) => message.text)).toEqual([
      "primeira",
      "resposta primeira",
      "segunda",
      "resposta segunda",
    ]);
    brain.stop();
  });

  it("keeps the queue usable after a failed primary turn and still uses the fallback", async () => {
    const events = new InMemoryEventBus();
    let attempts = 0;
    const model: LanguageModel = {
      generateResponse: vi.fn(async (input: AssistantInput): Promise<LanguageModelReply> => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Ollama indisponível");
        }
        return reply(`modelo ${input.type === "sign" ? input.recognition.gloss : input.text}`);
      }),
    };
    const fallback: LanguageModel = {
      generateResponse: vi.fn(async (): Promise<LanguageModelReply> => ({
        text: "resposta offline",
        source: "rules",
        intent: "conversation",
        emotion: "neutral",
        gesture: "listen",
      })),
    };
    const responses: string[] = [];
    events.on("brain.response", ({ response }) => responses.push(response.text));
    const brain = new EventDrivenBrainEngine(events, model, fallback);
    brain.start();

    events.emit({ type: "voice.transcription", text: "primeira", timestamp: 1 });
    await vi.waitFor(() => expect(responses).toEqual(["resposta offline"]));

    events.emit({ type: "voice.transcription", text: "segunda", timestamp: 2 });
    await vi.waitFor(() =>
      expect(responses).toEqual(["resposta offline", "modelo segunda"]),
    );
    expect(brain.getConversation().map((message) => message.text)).toEqual([
      "primeira",
      "resposta offline",
      "segunda",
      "modelo segunda",
    ]);
    brain.stop();
  });

  it("does not publish or append a response that finishes after stop", async () => {
    const events = new InMemoryEventBus();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model: LanguageModel = {
      generateResponse: vi.fn(async (): Promise<LanguageModelReply> => {
        await gate;
        return reply("resposta tardia");
      }),
    };
    const responses: string[] = [];
    events.on("brain.response", ({ response }) => responses.push(response.text));
    const brain = new EventDrivenBrainEngine(events, model);
    brain.start();

    events.emit({ type: "voice.transcription", text: "em andamento", timestamp: 1 });
    await vi.waitFor(() => expect(model.generateResponse).toHaveBeenCalledOnce());
    brain.stop();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(responses).toEqual([]);
    expect(brain.getConversation()).toEqual([]);
  });
});

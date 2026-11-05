import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../core/event-bus";
import type { AssistantResponse } from "../core/messages";
import type { LanguageModel } from "./language-model";
import { EventDrivenBrainEngine } from "./event-driven-brain-engine";

describe("EventDrivenBrainEngine LLM failure handling", () => {
  it("emits a core error when the fallback also fails", async () => {
    const events = new InMemoryEventBus();
    const model: LanguageModel = {
      generateResponse: vi.fn().mockRejectedValue(new Error("Ollama indisponível")),
    };
    const fallback: LanguageModel = {
      generateResponse: vi.fn().mockRejectedValue(new Error("Fallback indisponível")),
    };
    const brain = new EventDrivenBrainEngine(events, model, fallback);
    const coreErrors: Array<{ source: string; message: string }> = [];
    const responses: AssistantResponse[] = [];
    events.on("core.error", (event) => coreErrors.push(event));
    events.on("brain.response", ({ response }) => responses.push(response));

    brain.start();
    events.emit({ type: "voice.transcription", text: "Olá", timestamp: 1 });
    await vi.waitFor(() => expect(coreErrors).toHaveLength(1));

    expect(coreErrors[0]?.source).toBe("brain");
    expect(coreErrors[0]?.message).toContain("LLM_STATUS = UNAVAILABLE.");
    expect(coreErrors[0]?.message).toContain("Fallback indisponível");
    expect(responses).toHaveLength(0);
    expect(brain.getConversation()).toHaveLength(1);
    brain.stop();
  });

  it("publishes checking and available brain.llm-status events", async () => {
    const events = new InMemoryEventBus();
    const llmStatuses: Array<{ status: string; model: string; message: string }> = [];
    events.on("brain.llm-status", (event) => llmStatuses.push(event));
    const model: LanguageModel = {
      modelName: "qwen2.5:0.5b",
      checkAvailability: vi.fn().mockResolvedValue({
        status: "available",
        model: "qwen2.5:0.5b",
        message: "Ollama disponível; modelo qwen2.5:0.5b instalado.",
      }),
      generateResponse: vi.fn(),
    };
    const brain = new EventDrivenBrainEngine(events, model);
    brain.start();
    await vi.waitFor(() => expect(llmStatuses.map((event) => event.status)).toEqual(["checking", "available"]));
    brain.stop();
  });

  it("publishes an unavailable brain.llm-status event when the availability check fails", async () => {
    const events = new InMemoryEventBus();
    const llmStatuses: Array<{ status: string; model: string; message: string }> = [];
    events.on("brain.llm-status", (event) => llmStatuses.push(event));
    const model: LanguageModel = {
      modelName: "qwen2.5:0.5b",
      checkAvailability: vi.fn().mockRejectedValue(new Error("Ollama fora do ar")),
      generateResponse: vi.fn(),
    };
    const brain = new EventDrivenBrainEngine(events, model);
    brain.start();
    await vi.waitFor(() => expect(llmStatuses[llmStatuses.length - 1]?.status).toBe("unavailable"));
    expect(llmStatuses[0]?.status).toBe("checking");
    expect(llmStatuses[1]?.status).toBe("unavailable");
    expect(llmStatuses[1]?.message).toContain("Ollama fora do ar");
    brain.stop();
  });

  it("publishes a model-missing brain.llm-status event when the configured model is absent", async () => {
    const events = new InMemoryEventBus();
    const llmStatuses: Array<{ status: string; model: string; message: string }> = [];
    events.on("brain.llm-status", (event) => llmStatuses.push(event));
    const model: LanguageModel = {
      modelName: "qwen2.5:0.5b",
      checkAvailability: vi.fn().mockResolvedValue({
        status: "model-missing",
        model: "qwen2.5:0.5b",
        message: "LLM_STATUS = UNAVAILABLE. Modelo qwen2.5:0.5b ausente.",
      }),
      generateResponse: vi.fn(),
    };
    const brain = new EventDrivenBrainEngine(events, model);
    brain.start();
    await vi.waitFor(() => expect(llmStatuses.map((event) => event.status)).toEqual(["checking", "model-missing"]));
    brain.stop();
  });

  it("keeps answering when the model does not expose availability checks", async () => {
    const events = new InMemoryEventBus();
    const llmStatuses: Array<{ status: string }> = [];
    events.on("brain.llm-status", (event) => llmStatuses.push({ status: event.status }));
    const generateResponse = vi.fn().mockResolvedValue({
      text: "Estou bem.",
      source: "local-llm",
      intent: "conversation",
      emotion: "neutral",
      gesture: "nod",
    });
    const model: LanguageModel = { generateResponse };
    const brain = new EventDrivenBrainEngine(events, model);
    const responsePromise = new Promise<AssistantResponse>((resolve) => {
      events.on("brain.response", ({ response }) => resolve(response));
    });

    brain.start();
    events.emit({ type: "voice.transcription", text: "Oi", timestamp: 1 });
    const response = await responsePromise;
    expect(response.source).toBe("local-llm");
    expect(llmStatuses).toHaveLength(0);
    brain.stop();
  });
});

import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../core/event-bus";
import type { AssistantResponse, ConversationState } from "../core/messages";
import type { LanguageModel } from "./language-model";
import { EventDrivenBrainEngine } from "./event-driven-brain-engine";

describe("EventDrivenBrainEngine event integration", () => {
  it("ignores events emitted after stop and clears the conversation context", async () => {
    const events = new InMemoryEventBus();
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
    events.emit({ type: "voice.transcription", text: "Olá", timestamp: 10 });
    const response = await responsePromise;
    expect(response.inReplyTo).toMatchObject({ type: "transcription", text: "Olá" });
    brain.stop();

    expect(brain.getConversation()).toHaveLength(0);

    let lateResponseReceived = false;
    events.on("brain.response", () => {
      lateResponseReceived = true;
    });
    events.emit({ type: "voice.transcription", text: "Novamente", timestamp: 20 });
    await Promise.resolve();
    await Promise.resolve();
    expect(lateResponseReceived).toBe(false);
    expect(generateResponse).toHaveBeenCalledTimes(1);
  });

  it("keeps a single subscription when start is called repeatedly", async () => {
    const events = new InMemoryEventBus();
    const generateResponse = vi.fn().mockResolvedValue({
      text: "Estou bem.",
      source: "local-llm",
      intent: "conversation",
      emotion: "neutral",
      gesture: "nod",
    });
    const model: LanguageModel = { generateResponse };
    const brain = new EventDrivenBrainEngine(events, model);
    brain.start();
    brain.start();

    const responsePromise = new Promise<AssistantResponse>((resolve) => {
      events.on("brain.response", ({ response }) => resolve(response));
    });
    events.emit({
      type: "vision.sign-recognized",
      recognition: { sign: "obrigado", gloss: "OBRIGADO", confidence: 0.91, timestamp: 42 },
    });
    const response = await responsePromise;
    expect(response.inReplyTo).toMatchObject({ type: "sign" });
    expect(generateResponse).toHaveBeenCalledOnce();
    brain.stop();
  });

  it("clears the conversation and tolerates stopping an already stopped brain", async () => {
    const events = new InMemoryEventBus();
    const generateResponse = vi.fn().mockResolvedValue({
      text: "Estou bem.",
      source: "local-llm",
      intent: "conversation",
      emotion: "neutral",
      gesture: "nod",
    });
    const model: LanguageModel = { generateResponse };
    const brain = new EventDrivenBrainEngine(events, model);
    brain.start();
    const responsePromise = new Promise<AssistantResponse>((resolve) => {
      events.on("brain.response", ({ response }) => resolve(response));
    });
    events.emit({ type: "voice.transcription", text: "Oi", timestamp: 1 });
    await responsePromise;
    brain.stop();
    expect(() => brain.stop()).not.toThrow();
    expect(brain.getConversation()).toHaveLength(0);
  });

  it("publishes the processing state before answering and keeps the user turn in the transcript", async () => {
    const events = new InMemoryEventBus();
    const states: ConversationState[] = [];
    events.on("conversation.state", ({ state }) => states.push(state));
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
    events.emit({ type: "voice.transcription", text: "Preciso de ajuda", timestamp: 99 });
    await responsePromise;

    expect(states).toEqual(["processing"]);
    expect(brain.getConversation().map((message) => message.text)).toEqual([
      "Preciso de ajuda",
      "Estou bem.",
    ]);
    brain.stop();
  });

  it("answers duplicated events as independent conversation turns", async () => {
    const events = new InMemoryEventBus();
    const generateResponse = vi.fn()
      .mockResolvedValueOnce({ text: "Primeira resposta", source: "mock", intent: "conversation", emotion: "neutral", gesture: "nod" })
      .mockResolvedValueOnce({ text: "Segunda resposta", source: "mock", intent: "conversation", emotion: "neutral", gesture: "nod" });
    const model: LanguageModel = { generateResponse };
    const brain = new EventDrivenBrainEngine(events, model);
    const responses: AssistantResponse[] = [];
    events.on("brain.response", ({ response }) => responses.push(response));

    brain.start();
    events.emit({ type: "voice.transcription", text: "Obrigado", timestamp: 7 });
    events.emit({ type: "voice.transcription", text: "Obrigado", timestamp: 7 });
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    await vi.waitFor(() => expect(brain.getConversation()).toHaveLength(4));

    expect(responses[0]?.text).toBe("Primeira resposta");
    expect(responses[1]?.text).toBe("Segunda resposta");
    expect(brain.getConversation().map((message) => message.text)).toEqual([
      "Obrigado",
      "Primeira resposta",
      "Obrigado",
      "Segunda resposta",
    ]);
    brain.stop();
  });

  it("answers sign and speech events emitted out of order and keeps the transcript turns", async () => {
    const events = new InMemoryEventBus();
    const generateResponse = vi.fn().mockResolvedValue({
      text: "Estou bem.",
      source: "local-llm",
      intent: "conversation",
      emotion: "neutral",
      gesture: "nod",
    });
    const model: LanguageModel = { generateResponse };
    const brain = new EventDrivenBrainEngine(events, model);
    const firstResponsePromise = new Promise<AssistantResponse>((resolve) => {
      events.on("brain.response", ({ response }) => {
        if (response.inReplyTo.type === "sign") {
          resolve(response);
        }
      });
    });

    brain.start();
    events.emit({
      type: "vision.sign-recognized",
      recognition: { sign: "obrigado", gloss: "OBRIGADO", confidence: 0.91, timestamp: 42 },
    });
    const firstResponse = await firstResponsePromise;
    expect(firstResponse.inReplyTo).toMatchObject({ type: "sign" });

    const secondResponsePromise = new Promise<AssistantResponse>((resolve) => {
      events.on("brain.response", ({ response }) => {
        if (response.inReplyTo.type === "transcription") {
          resolve(response);
        }
      });
    });
    events.emit({ type: "voice.transcription", text: "Obrigado", timestamp: 43 });
    const secondResponse = await secondResponsePromise;
    expect(secondResponse.inReplyTo).toMatchObject({ type: "transcription" });

    expect(brain.getConversation().map((message) => message.text)).toEqual([
      "OBRIGADO",
      "Estou bem.",
      "Obrigado",
      "Estou bem.",
    ]);
    brain.stop();
  });
});

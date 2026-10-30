import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalLLMEngine } from "./local-llm-engine";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalLLMEngine", () => {
  it("sends a recognized sign to the local model and validates its structured reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            text: "De nada! Como posso ajudar?",
            intent: "acknowledge",
            emotion: "happy",
            gesture: "nod",
          }),
        },
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const model = new LocalLLMEngine("http://localhost:11434/api/chat", "local-test");

    const reply = await model.generateResponse(
      {
        type: "sign",
        timestamp: 1,
        recognition: {
          sign: "obrigado",
          gloss: "OBRIGADO",
          confidence: 0.93,
          timestamp: 1,
        },
      },
      [],
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      model: string;
      messages: Array<{ content: string }>;
      format: { properties: Record<string, unknown>; required: string[] };
    };
    expect(request.model).toBe("local-test");
    expect(request.messages.at(-1)?.content).toContain("OBRIGADO");
    expect(request.format.required).toEqual(["text", "intent", "emotion", "gesture"]);
    expect(request.format.properties).toHaveProperty("text");
    expect(reply).toEqual({
      text: "De nada! Como posso ajudar?",
      source: "local-llm",
      intent: "acknowledge",
      emotion: "happy",
      gesture: "nod",
    });
  });

  it("rejects malformed structured output instead of substituting a canned answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: '{"text":"oi","emotion":"angry"}' } }), {
        status: 200,
      }),
    ));
    const model = new LocalLLMEngine("http://localhost:11434/api/chat", "local-test");

    await expect(model.generateResponse(
      { type: "transcription", timestamp: 1, text: "Oi" },
      [],
    )).rejects.toThrow("não corresponde ao contrato esperado");
  });

  it("validates every required response field", async () => {
    const invalidReplies = [
      { text: "", intent: "conversation", emotion: "neutral", gesture: "nod" },
      { text: "ok", intent: "unknown", emotion: "neutral", gesture: "nod" },
      { text: "ok", intent: "conversation", emotion: "angry", gesture: "nod" },
      { text: "ok", intent: "conversation", emotion: "neutral", gesture: "jump" },
    ];
    const model = new LocalLLMEngine("http://localhost:11434/api/chat", "local-test");
    for (const reply of invalidReplies) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          message: { content: JSON.stringify(reply) },
        }), { status: 200 }),
      ));
      await expect(model.generateResponse(
        { type: "transcription", timestamp: 1, text: "Oi" },
        [],
      )).rejects.toThrow("não corresponde ao contrato esperado");
    }
  });

  it("reports unavailable local Ollama instead of falling back to a mock", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const model = new LocalLLMEngine("http://localhost:11434/api/chat", "local-test");

    await expect(model.generateResponse(
      { type: "transcription", timestamp: 1, text: "Oi" },
      [],
    )).rejects.toThrow("fetch failed");
  });

  it("detects the configured model and reports when it is not installed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "other:latest" }] }), { status: 200 }),
    ));
    const model = new LocalLLMEngine("http://localhost:11434/api/chat", "qwen2.5:0.5b");
    await expect(model.checkAvailability()).resolves.toEqual({
      status: "model-missing",
      model: "qwen2.5:0.5b",
      message: "LLM_STATUS = UNAVAILABLE. Modelo qwen2.5:0.5b ausente. Instale-o manualmente com: ollama pull qwen2.5:0.5b",
    });
  });

  it("detects when the selected model is installed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen2.5:0.5b" }] }), { status: 200 }),
    ));
    const model = new LocalLLMEngine("http://localhost:11434/api/chat", "qwen2.5:0.5b");

    await expect(model.checkAvailability()).resolves.toMatchObject({
      status: "available",
      model: "qwen2.5:0.5b",
    });
  });

  it("reports UNAVAILABLE when the local Ollama endpoint is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection refused")));
    const model = new LocalLLMEngine("http://127.0.0.1:11434/api/chat", "qwen2.5:0.5b");

    await expect(model.checkAvailability()).resolves.toMatchObject({
      status: "unavailable",
      model: "qwen2.5:0.5b",
      message: expect.stringContaining("LLM_STATUS = UNAVAILABLE"),
    });
  });
});

import type { AssistantInput, AssistantIntent, Emotion, Gesture } from "../core/messages";
import type { ConversationMessage } from "../core/messages";
import type {
  LanguageModel,
  LanguageModelAvailability,
  LanguageModelReply,
} from "./language-model";
import { isAssistantIntent } from "./rule-engine";
import { peterConfig } from "../core/config";

interface OllamaChatResponse {
  readonly message?: { readonly content?: unknown };
  readonly error?: string;
}

const emotions = new Set<Emotion>(["happy", "sad", "neutral", "thinking"]);
const gestures = new Set<Gesture>(["wave", "nod", "shake_head", "thinking", "point", "listen"]);
const replyFormat = {
  type: "object",
  properties: {
    text: { type: "string" },
    intent: { type: "string", enum: ["acknowledge", "greeting", "help", "conversation"] },
    emotion: { type: "string", enum: ["happy", "sad", "neutral", "thinking"] },
    gesture: { type: "string", enum: ["wave", "nod", "shake_head", "thinking", "point", "listen"] },
  },
  required: ["text", "intent", "emotion", "gesture"],
  additionalProperties: false,
} as const;
export class LocalLLMProvider implements LanguageModel {
  readonly modelName: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(
    endpoint = peterConfig.brain.ollamaUrl,
    model = peterConfig.brain.ollamaModel,
    timeoutMs = peterConfig.brain.ollamaTimeoutMs,
  ) {
    this.endpoint = endpoint;
    this.modelName = model;
    this.timeoutMs = timeoutMs;
  }

  async checkAvailability(): Promise<LanguageModelAvailability> {
    const tagsEndpoint = this.tagsEndpoint();
    try {
      const response = await fetch(tagsEndpoint, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) {
        return {
          status: "unavailable",
          model: this.modelName,
          message: `LLM_STATUS = UNAVAILABLE. Ollama respondeu HTTP ${response.status}.`,
        };
      }
      const payload: unknown = await response.json();
      if (!isOllamaTagsResponse(payload)) {
        throw new Error("Ollama retornou uma lista de modelos em formato inválido.");
      }
      const installed = payload.models.some((model) => model.name === this.modelName);
      return installed
        ? {
            status: "available",
            model: this.modelName,
            message: `Ollama disponível; modelo ${this.modelName} instalado.`,
          }
        : {
            status: "model-missing",
            model: this.modelName,
            message: `LLM_STATUS = UNAVAILABLE. Modelo ${this.modelName} ausente. Instale-o manualmente com: ollama pull ${this.modelName}`,
          };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "falha de conexão";
      return {
        status: "unavailable",
        model: this.modelName,
        message: `LLM_STATUS = UNAVAILABLE. Ollama não respondeu em ${tagsEndpoint}: ${detail}`,
      };
    }
  }

  async generateResponse(
    input: AssistantInput,
    context: readonly ConversationMessage[],
  ): Promise<LanguageModelReply> {
    try {
      const history = context.slice(-12).map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.text,
      }));
      const message = input.type === "sign"
        ? `A pessoa sinalizou: ${input.recognition.gloss}. Responda considerando esse significado.`
        : input.text;
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.modelName,
          stream: false,
          format: replyFormat,
          keep_alive: "2m",
          options: {
            num_ctx: 2048,
            num_predict: 120,
            temperature: 0.2,
          },
          messages: [
            {
              role: "system",
              content:
                "Você é Peter, um assistente acessível e cordial. Responda em português brasileiro, " +
                "de forma breve e natural. Preencha todos os campos JSON solicitados. " +
                "Gestos são reações do avatar, não traduções de Libras.",
            },
            ...history,
            { role: "user", content: message },
          ],
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const detail = isOllamaResponse(payload) ? payload.error : undefined;
        throw new Error(detail ?? `Ollama respondeu HTTP ${response.status}.`);
      }
      if (!isOllamaResponse(payload) || typeof payload.message?.content !== "string") {
        throw new Error("Ollama retornou uma resposta sem conteúdo válido.");
      }
      return parseReply(payload.message.content);
    } catch (error) {
      if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new Error(`O modelo local excedeu o tempo limite de ${this.timeoutMs / 1000}s.`);
      }
      throw error;
    }
  }

  private tagsEndpoint(): string {
    return this.endpoint.replace(/\/api\/chat\/?$/, "/api/tags");
  }
}

/** Backward-compatible engine name for existing callers and tests. */
export class LocalLLMEngine extends LocalLLMProvider {}

function isOllamaResponse(value: unknown): value is OllamaChatResponse {
  return typeof value === "object" && value !== null;
}

function isOllamaTagsResponse(
  value: unknown,
): value is { readonly models: readonly { readonly name: string }[] } {
  return typeof value === "object" &&
    value !== null &&
    "models" in value &&
    Array.isArray(value.models) &&
    value.models.every((model) =>
      typeof model === "object" &&
      model !== null &&
      "name" in model &&
      typeof model.name === "string",
    );
}

function parseReply(content: string): LanguageModelReply {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("Ollama não retornou JSON válido para a resposta do Brain.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Resposta do modelo local deve ser um objeto JSON.");
  }
  const reply = value as Record<string, unknown>;
  const invalidFields = [
    ...(typeof reply.text !== "string" || reply.text.trim().length === 0 ? ["text"] : []),
    ...(!isAssistantIntent(reply.intent) ? ["intent"] : []),
    ...(typeof reply.emotion !== "string" || !emotions.has(reply.emotion as Emotion) ? ["emotion"] : []),
    ...(typeof reply.gesture !== "string" || !gestures.has(reply.gesture as Gesture) ? ["gesture"] : []),
  ];
  if (invalidFields.length > 0) {
    throw new Error(`Resposta do modelo local não corresponde ao contrato esperado (campos: ${invalidFields.join(", ")}).`);
  }
  return {
    text: (reply.text as string).trim(),
    source: "local-llm",
    intent: reply.intent as AssistantIntent,
    emotion: reply.emotion as Emotion,
    gesture: reply.gesture as Gesture,
  };
}

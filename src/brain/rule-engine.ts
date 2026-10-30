import type { AssistantInput, AssistantIntent } from "../core/messages";
import type { LanguageModelReply } from "./language-model";

const ACKNOWLEDGEMENT: LanguageModelReply = {
  text: "De nada! Estou aqui para ajudar.",
  source: "rules",
  intent: "acknowledge",
  emotion: "happy",
  gesture: "nod",
};

const RULES: ReadonlyArray<{
  readonly matches: (text: string) => boolean;
  readonly reply: LanguageModelReply;
}> = [
  {
    matches: (text) => /^(oi|ola|bom dia|boa tarde|boa noite)(\b|$)/.test(text),
    reply: { text: "Olá! Eu sou o Peter. Como posso ajudar?", source: "rules", intent: "greeting", emotion: "happy", gesture: "wave" },
  },
  {
    matches: (text) => /\btudo bem\b|\bcomo voce esta\b/.test(text),
    reply: { text: "Estou bem e pronto para conversar com você. E você?", source: "rules", intent: "conversation", emotion: "happy", gesture: "nod" },
  },
  {
    matches: (text) => /\bobrigad[oa]s?\b/.test(text),
    reply: ACKNOWLEDGEMENT,
  },
  {
    matches: (text) => /\bquem e voce\b|\bseu nome\b/.test(text),
    reply: { text: "Eu sou o Peter, um assistente acessível feito para conversar com você.", source: "rules", intent: "conversation", emotion: "neutral", gesture: "listen" },
  },
  {
    matches: (text) => /\bajuda\b|\bpreciso de ajuda\b/.test(text),
    reply: { text: "Claro. Conte o que aconteceu e vou tentar ajudar.", source: "rules", intent: "help", emotion: "thinking", gesture: "listen" },
  },
];

export class RuleEngine {
  resolve(input: AssistantInput): LanguageModelReply | undefined {
    const text = input.type === "sign" ? input.recognition.gloss : input.text;
    const normalized = normalize(text);
    return RULES.find((rule) => rule.matches(normalized))?.reply;
  }
}

export function isAssistantIntent(value: unknown): value is AssistantIntent {
  return value === "acknowledge" ||
    value === "greeting" ||
    value === "help" ||
    value === "conversation";
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

import type { ConversationState } from "../core/messages";

export const conversationStatusLabel: Readonly<Record<ConversationState, string>> = {
  idle: "Toque para falar",
  listening: "Ouvindo...",
  transcribing: "Transcrevendo...",
  processing: "Processando...",
  responding: "Peter está respondendo...",
  error: "Erro · tente novamente",
};

import { describe, expect, it } from "vitest";
import { conversationStatusLabel } from "./conversation-status";

describe("conversation status UI labels", () => {
  it("provides a clear label for each live speech/response state", () => {
    expect(conversationStatusLabel).toEqual({
      idle: "Toque para falar",
      listening: "Ouvindo...",
      transcribing: "Transcrevendo...",
      processing: "Processando...",
      responding: "Peter está respondendo...",
      error: "Erro · tente novamente",
    });
  });
});

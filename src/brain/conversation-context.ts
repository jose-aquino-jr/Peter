import type { ConversationMessage } from "../core/messages";

/**
 * Enough turns to keep continuity without letting a long session grow forever.
 * The local model only reads the most recent messages, so older turns are not
 * useful for inference and must not be retained indefinitely.
 */
export const DEFAULT_MAX_MESSAGES = 40;

export class ConversationContext {
  private readonly messages: ConversationMessage[] = [];

  constructor(private readonly maxMessages: number = DEFAULT_MAX_MESSAGES) {
    if (!Number.isInteger(maxMessages) || maxMessages < 1) {
      throw new Error("O limite do contexto deve ser um inteiro positivo.");
    }
  }

  add(message: ConversationMessage): void {
    this.messages.push(message);
    if (this.messages.length > this.maxMessages) {
      this.messages.splice(0, this.messages.length - this.maxMessages);
    }
  }

  getMessages(): readonly ConversationMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages.length = 0;
  }
}

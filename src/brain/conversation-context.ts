import type { ConversationMessage } from "../core/messages";

export class ConversationContext {
  private readonly messages: ConversationMessage[] = [];

  add(message: ConversationMessage): void {
    this.messages.push(message);
  }

  getMessages(): readonly ConversationMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages.length = 0;
  }
}

import type { EventOfType, PeterEvent, PeterEventType } from "./events";

type EventHandler<Event extends PeterEvent> = (event: Event) => void;
type StoredHandler = (event: PeterEvent) => void;

export interface EventBus {
  on<Type extends PeterEventType>(
    type: Type,
    handler: EventHandler<EventOfType<Type>>,
  ): () => void;
  emit(event: PeterEvent): void;
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<PeterEventType, Set<StoredHandler>>();

  on<Type extends PeterEventType>(
    type: Type,
    handler: EventHandler<EventOfType<Type>>,
  ): () => void {
    let listeners = this.handlers.get(type);
    if (!listeners) {
      listeners = new Set<StoredHandler>();
      this.handlers.set(type, listeners);
    }

    const storedHandler: StoredHandler = (event) => {
      if (event.type === type) {
        handler(event as EventOfType<Type>);
      }
    };
    listeners.add(storedHandler);

    return () => {
      listeners?.delete(storedHandler);
      if (listeners?.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  emit(event: PeterEvent): void {
    for (const handler of [...(this.handlers.get(event.type) ?? [])]) {
      handler(event);
    }
  }
}

import type { ToolLifecycleEvent } from "@clpc/tools";

export type EventType =
  | "session_created"
  | "message_received"
  | "session_status"
  | "token"
  | "response_complete"
  | "tool_started"
  | "tool_progress"
  | "tool_completed"
  | "tool_failed"
  | "approval_requested"
  | "error";

export interface SessionStatusEvent {
  sessionId: string;
  status: string;
}

export interface TokenEvent {
  sessionId: string;
  messageId: string;
  content: string;
}

export interface ApprovalRequestEvent {
  sessionId: string;
  approvalId: string;
  toolName: string;
  reason: string;
}

export interface ErrorEvent {
  sessionId: string;
  message: string;
}

export type EventHandler<T = unknown> = (data: T) => void;

export interface EventBus {
  emit<T = unknown>(event: EventType, data: T): void;
  on<T = unknown>(event: EventType, handler: EventHandler<T>): void;
  off<T = unknown>(event: EventType, handler: EventHandler<T>): void;
}

export class SimpleEventBus implements EventBus {
  private handlers = new Map<EventType, Set<EventHandler<unknown>>>();

  emit<T = unknown>(event: EventType, data: T): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch {
        // a handler must not break the bus
      }
    }
  }

  on<T = unknown>(event: EventType, handler: EventHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<T = unknown>(event: EventType, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<unknown>);
    }
  }
}

export type { ToolLifecycleEvent };
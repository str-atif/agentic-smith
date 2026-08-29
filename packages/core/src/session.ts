import { AgentSession, Message } from "@clpc/types";
import { deriveSessionTitle } from "./store";

export interface SessionManagerOptions {
  persist?: (session: AgentSession) => void | Promise<void>;
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>();
  private readonly persist?: (session: AgentSession) => void | Promise<void>;

  constructor(options: SessionManagerOptions = {}) {
    this.persist = options.persist;
  }

  createSession(modelId: string, modelName: string): AgentSession {
    return this.buildSession(crypto.randomUUID(), modelId, modelName);
  }

  attachSession(id: string, modelId: string, modelName: string): AgentSession {
    const existing = this.sessions.get(id);
    if (existing) {
      return existing;
    }
    return this.buildSession(id, modelId, modelName);
  }

  restore(session: AgentSession): AgentSession {
    this.sessions.set(session.id, session);
    return session;
  }

  private buildSession(id: string, modelId: string, modelName: string): AgentSession {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id,
      messages: [],
      modelId,
      modelName,
      status: "idle",
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  addMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.messages.push(message);
    if (!session.title || session.title === "New conversation") {
      session.title = deriveSessionTitle(session);
    }
    this.touch(session);
    this.persistSession(session);
  }

  updateStatus(sessionId: string, status: AgentSession["status"]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.status !== status || !session.updatedAt) {
      session.status = status;
      this.touch(session);
      this.persistSession(session);
    }
  }

  updateProvider(sessionId: string, modelId: string, modelName: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.modelId = modelId;
    session.modelName = modelName;
    this.touch(session);
    this.persistSession(session);
  }

  listSessions(): AgentSession[] {
    return [...this.sessions.values()];
  }

  remove(id: string): boolean {
    return this.sessions.delete(id);
  }

  private touch(session: AgentSession): void {
    session.updatedAt = new Date().toISOString();
  }

  private persistSession(session: AgentSession): void {
    if (!this.persist) return;
    const snapshot: AgentSession = {
      ...session,
      messages: [...session.messages],
    };
    void Promise.resolve(this.persist(snapshot)).catch(() => {
      // persistence must never break the agent loop
    });
  }
}
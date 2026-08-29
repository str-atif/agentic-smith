import { AgentSession, Message } from "@clpc/types";

export class SessionManager {
  private sessions = new Map<string, AgentSession>();

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

  private buildSession(id: string, modelId: string, modelName: string): AgentSession {
    const session: AgentSession = {
      id,
      messages: [],
      modelId,
      modelName,
      status: "idle",
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  addMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(message);
    }
  }

  updateStatus(sessionId: string, status: AgentSession["status"]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
    }
  }

  updateProvider(sessionId: string, modelId: string, modelName: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.modelId = modelId;
      session.modelName = modelName;
    }
  }

  listSessions(): AgentSession[] {
    return [...this.sessions.values()];
  }
}
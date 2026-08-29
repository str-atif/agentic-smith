import { AgentSession, Message, SessionSummary } from "@clpc/types";
import fs from "fs";
import path from "path";

export interface SessionStore {
  list(): Promise<AgentSession[]>;
  load(id: string): Promise<AgentSession | undefined>;
  save(session: AgentSession): Promise<void>;
  delete(id: string): Promise<void>;
}

const SECRET_PATTERN = /api.?key|secret|authorization|bearer|password/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_PATTERN.test(key)) continue;
      out[key] = redact(child);
    }
    return out;
  }
  return value;
}

export function serializableSession(session: AgentSession): AgentSession {
  return {
    ...session,
    messages: session.messages.map((message: Message): Message => ({
      ...message,
      metadata: redact(message.metadata) as Record<string, unknown> | undefined,
    })),
  };
}

export function deriveSessionTitle(session: AgentSession): string {
  const firstUser = session.messages.find((message) => message.role === "user");
  const text = (firstUser?.content ?? "New conversation").trim();
  const singleLine = text.replace(/\s+/g, " ");
  return singleLine.length > 56 ? `${singleLine.slice(0, 56)}…` : singleLine || "New conversation";
}

export function toSessionSummary(session: AgentSession): SessionSummary {
  const updatedAt = session.updatedAt ?? new Date().toISOString();
  return {
    id: session.id,
    title: session.title || deriveSessionTitle(session),
    modelId: session.modelId,
    modelName: session.modelName,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt,
    messageCount: session.messages.length,
  };
}

export const sessionsFilePath = (dir: string, sessionId: string): string =>
  path.join(dir, `${sessionId}.json`);

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, AgentSession>();

  async list(): Promise<AgentSession[]> {
    return [...this.sessions.values()];
  }

  async load(id: string): Promise<AgentSession | undefined> {
    return this.sessions.get(id);
  }

  async save(session: AgentSession): Promise<void> {
    this.sessions.set(session.id, { ...session, messages: [...session.messages] });
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

export class FileSessionStore implements SessionStore {
  private readonly dir: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
  }

  private ensureDir(): Promise<void> {
    return fs.promises.mkdir(this.dir, { recursive: true }).then(() => undefined);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(work, work);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<AgentSession[]> {
    await this.ensureDir();
    let names: string[];
    try {
      names = await fs.promises.readdir(this.dir);
    } catch {
      return [];
    }
    const sessions: AgentSession[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await fs.promises.readFile(path.join(this.dir, name), "utf-8");
        const parsed = JSON.parse(raw) as AgentSession;
        if (parsed && parsed.id && parsed.messages) {
          sessions.push(parsed);
        }
      } catch {
        // skip corrupt session files
      }
    }
    return sessions.sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
    );
  }

  async load(id: string): Promise<AgentSession | undefined> {
    await this.ensureDir();
    try {
      const raw = await fs.promises.readFile(sessionsFilePath(this.dir, id), "utf-8");
      const parsed = JSON.parse(raw) as AgentSession;
      if (parsed && parsed.id && parsed.messages) return parsed;
      return undefined;
    } catch {
      return undefined;
    }
  }

  async save(session: AgentSession): Promise<void> {
    await this.ensureDir();
    const target = serializableSession(session);
    const file = sessionsFilePath(this.dir, session.id);
    await this.enqueue(async () => {
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(target, null, 2), "utf-8");
      await fs.promises.rename(tmp, file);
    });
  }

  async delete(id: string): Promise<void> {
    await this.ensureDir();
    await this.enqueue(async () => {
      await fs.promises.rm(sessionsFilePath(this.dir, id), { force: true });
    });
  }
}
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { AgentSession, Message } from "@clpc/types";
import {
  FileSessionStore,
  MemorySessionStore,
  deriveSessionTitle,
  serializableSession,
  toSessionSummary,
} from "./store";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clpc-sessions-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildMessage(partial: Partial<Message> & { id: string; role: Message["role"] }): Message {
  return {
    content: "",
    timestamp: new Date().toISOString(),
    ...partial,
  };
}

function buildSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    messages: [
      buildMessage({ id: "m1", role: "user", content: "Build a spawn point at the center" }),
      buildMessage({ id: "m2", role: "assistant", content: "I will do that." }),
      buildMessage({
        id: "m3",
        role: "tool",
        toolCallId: "t1",
        content: '{"ok":true}',
      }),
    ],
    modelId: "openai",
    modelName: "gpt-4o",
    status: "completed",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:01:00.000Z",
    ...overrides,
  };
}

describe("FileSessionStore", () => {
  it("persists and reloads a session with full fidelity", async () => {
    const store = new FileSessionStore(tmpDir);
    const session = buildSession();
    await store.save(session);

    const loaded = await store.load("s1");
    expect(loaded).toBeDefined();
    expect(loaded?.id).toBe("s1");
    expect(loaded?.messages).toHaveLength(3);
    expect(loaded?.messages[0].role).toBe("user");
    expect(loaded?.messages[1].role).toBe("assistant");
    expect(loaded?.messages[2].role).toBe("tool");
    expect(loaded?.messages[2].toolCallId).toBe("t1");
    expect(loaded?.messages[2].timestamp).toBe(session.messages[2].timestamp);
    expect(loaded?.modelId).toBe("openai");
    expect(loaded?.modelName).toBe("gpt-4o");
    expect(loaded?.status).toBe("completed");
  });

  it("restores conversations after a simulated restart", async () => {
    const first = new FileSessionStore(tmpDir);
    await first.save(buildSession());

    const second = new FileSessionStore(tmpDir);
    const restored = await second.load("s1");
    expect(restored?.messages[0].content).toBe("Build a spawn point at the center");
  });

  it("lists sessions sorted by most recent first", async () => {
    const store = new FileSessionStore(tmpDir);
    await store.save(buildSession({ id: "old", updatedAt: "2026-08-01T00:00:00.000Z" }));
    await store.save(buildSession({ id: "new", updatedAt: "2026-08-02T00:00:00.000Z" }));

    const list = await store.list();
    expect(list.map((session) => session.id)).toEqual(["new", "old"]);
  });

  it("deletes a session file", async () => {
    const store = new FileSessionStore(tmpDir);
    await store.save(buildSession());
    await store.delete("s1");
    expect(await store.load("s1")).toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, "s1.json"))).toBe(false);
  });

  it("tolerates corrupt session files during listing", async () => {
    await fs.promises.writeFile(path.join(tmpDir, "broken.json"), "{nope");
    const store = new FileSessionStore(tmpDir);
    await store.save(buildSession());
    const list = await store.list();
    expect(list.map((session) => session.id)).toEqual(["s1"]);
  });
});

describe("serializableSession", () => {
  it("redacts secret-like metadata keys", () => {
    const session = buildSession();
    session.messages.push(
      buildMessage({
        id: "m4",
        role: "system",
        content: "secret",
        metadata: {
          apiKey: "sk-1234",
          Authorization: "Bearer abc",
          safe: "keep",
        },
      })
    );
    const safe = serializableSession(session);
    const metadata = safe.messages[3].metadata ?? {};
    expect(metadata.apiKey).toBeUndefined();
    expect((metadata as Record<string, unknown>).Authorization).toBeUndefined();
    expect(metadata.safe).toBe("keep");
  });
});

describe("deriveSessionTitle", () => {
  it("uses the first user message line", () => {
    expect(deriveSessionTitle(buildSession())).toBe("Build a spawn point at the center");
  });

  it("falls back for empty sessions", () => {
    expect(deriveSessionTitle(buildSession({ messages: [], title: undefined }))).toBe(
      "New conversation"
    );
  });
});

describe("MemorySessionStore", () => {
  it("supports session lifecycle", async () => {
    const store = new MemorySessionStore();
    await store.save(buildSession());
    await store.save(buildSession({ id: "s2", title: "Second" }));

    expect(await store.load("s1")).toBeDefined();
    expect((await store.list()).map((session) => session.id).sort()).toEqual(["s1", "s2"]);

    await store.delete("s1");
    expect(await store.load("s1")).toBeUndefined();
  });

  it("builds session summaries", () => {
    const summary = toSessionSummary(buildSession({ id: "s9" }));
    expect(summary.id).toBe("s9");
    expect(summary.messageCount).toBe(3);
    expect(summary.updatedAt).toBe("2026-08-01T00:01:00.000Z");
  });
});
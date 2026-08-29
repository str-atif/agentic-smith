import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResponse, ModelProvider, StreamingEvent } from "@clpc/types";
import { AgentOrchestrator, AgentBusyError } from "./orchestrator";
import { SimpleEventBus } from "./events";
import { MemorySessionStore } from "./store";
import { ToolRegistry } from "@clpc/tools";
import { SessionManager } from "./session";

class StubProvider implements ModelProvider {
  readonly id = "stub";
  readonly displayName = "Stub";
  readonly modelName = "stub-model";
  readonly supportsStreaming = true;
  rounds: Array<{ tokens?: string[]; toolName?: string }> = [];

  async complete(_request: ChatRequest): Promise<ChatResponse> {
    return { id: "x", content: "complete", modelId: this.id };
  }

  async *stream(_request: ChatRequest): AsyncIterable<StreamingEvent> {
    const round = this.rounds.shift();
    if (round?.toolName) {
      yield { type: "tool_call", toolCall: { id: `t-${Math.random()}`, name: round.toolName, arguments: round.tokens?.length ? { bad: round.tokens[0] } : {} } };
      yield { type: "done" };
      return;
    }
    for (const token of round?.tokens ?? []) {
      yield { type: "token", content: token };
    }
    yield { type: "done" };
  }
}

function registryWithTools(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "inspect_scene",
    description: "Gets the current scene",
    parameters: { type: "object", properties: {} },
    requiresApproval: false,
    async execute() {
      return { ok: true, output: '{"scene":"Isle Land"}', durationMs: 1 };
    },
  });
  registry.register({
    name: "requires_text",
    description: "Requires a text argument",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    requiresApproval: false,
    async execute(call) {
      const text = String((call.arguments ?? {}).text ?? "");
      return { ok: true, output: `validated:${text}`, durationMs: 1 };
    },
  });
  return registry;
}

describe("AgentOrchestrator task states", () => {
  it("walks thinking → streaming → executing_tool → completed across a tool round", async () => {
    const provider = new StubProvider();
    provider.rounds = [
      { toolName: "inspect_scene" },
      { tokens: ["Scene is ready"] },
    ];

    const bus = new SimpleEventBus();
    const statuses: string[] = [];
    bus.on("session_status", (data: { status: string }) => statuses.push(data.status));

    const orch = new AgentOrchestrator({
      provider,
      toolRegistry: registryWithTools(),
      eventBus: bus,
      store: new MemorySessionStore(),
    });

    await orch.sendMessage("inspect the scene");

    expect(statuses).toContain("thinking");
    expect(statuses).toContain("streaming");
    expect(statuses).toContain("executing_tool");
    expect(statuses[statuses.length - 1]).toBe("completed");
  });

  it("emits message_received for assistant messages so the UI never waits blindly", async () => {
    const provider = new StubProvider();
    provider.rounds = [{ tokens: ["Hi"] }];

    const bus = new SimpleEventBus();
    const assistantIds: string[] = [];
    const tokens: Array<{ messageId: string; content: string }> = [];
    bus.on("message_received", (data: { role: string; id: string }) => {
      if (data.role === "assistant") assistantIds.push(data.id);
    });
    bus.on("token", (data: { messageId: string; content: string }) =>
      tokens.push(data)
    );

    const orch = new AgentOrchestrator({
      provider,
      eventBus: bus,
      store: new MemorySessionStore(),
    });
    await orch.sendMessage("say hi");

    expect(assistantIds.length).toBe(1);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(assistantIds).toContain(token.messageId);
    }
  });

  it("refuses overlapping sends with a busy error", async () => {
    const provider = new StubProvider();
    provider.rounds = [{ tokens: ["one"] }, { tokens: ["two"] }];
    const orch = new AgentOrchestrator({ provider });

    const first = orch.sendMessage("first");
    await expect(orch.sendMessage("second")).rejects.toBeInstanceOf(AgentBusyError);
    await first;
  });
});

describe("AgentOrchestrator tool failure handling", () => {
  it("records a validation error, emits a structured code, and lets the agent correct", async () => {
    const provider = new StubProvider();
    provider.rounds = [
      { toolName: "requires_text" },
      { tokens: ["Recovered after validation failure"] },
    ];

    const bus = new SimpleEventBus();
    const failedCodes: Array<string | undefined> = [];
    bus.on("tool_failed", (data: { code?: string }) => failedCodes.push(data.code));
    const agentErrors: Array<{ code: string }> = [];
    bus.on("agent_error", (data: { code: string }) => agentErrors.push(data));

    const orch = new AgentOrchestrator({
      provider,
      toolRegistry: registryWithTools(),
      eventBus: bus,
      store: new MemorySessionStore(),
    });
    await orch.sendMessage("use requires_text");

    const toolMessages = orch.getSession().messages.filter((message) => message.role === "tool");
    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0].content).toMatch(/Invalid arguments/);
    expect(failedCodes).toContain("tool_validation");
    expect(agentErrors.some((event) => event.code === "tool_validation")).toBe(true);
    expect(orch.getSession().status).toBe("completed");
  });

  it("times out a hanging tool and reports a timeout code while continuing the loop", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "hang_forever",
      description: "Never resolves",
      parameters: { type: "object", properties: {} },
      requiresApproval: false,
      execute() {
        return new Promise<never>(() => undefined);
      },
    });
    registry.register({
      name: "inspect_scene",
      description: "Gets the current scene",
      parameters: { type: "object", properties: {} },
      requiresApproval: false,
      async execute() {
        return { ok: true, output: "scene", durationMs: 1 };
      },
    });

    const provider = new StubProvider();
    provider.rounds = [
      { toolName: "hang_forever" },
      { toolName: "inspect_scene" },
      { tokens: ["done after timeout"] },
    ];

    const bus = new SimpleEventBus();
    const failures: Array<{ error: string; code?: string }> = [];
    bus.on("tool_failed", (data: { error: string; code?: string }) => failures.push(data));

    const orch = new AgentOrchestrator({
      provider,
      toolRegistry: registry,
      eventBus: bus,
      toolTimeoutMs: 80,
      store: new MemorySessionStore(),
    });

    await orch.sendMessage("run the hanging tool");

    const timedOut = failures.some((failure) => failure.code === "timeout");
    expect(timedOut).toBe(true);
    const toolMessages = orch.getSession().messages.filter((message) => message.role === "tool");
    expect(toolMessages.some((message) => /timed out/i.test(message.content))).toBe(true);
    expect(orch.getSession().messages.some((message) => /scene/.test(message.content))).toBe(true);
    expect(orch.getSession().status).toBe("completed");
  });
});

describe("AgentOrchestrator session lifecycle with persistence", () => {
  it("creates, opens, lists, and deletes sessions", async () => {
    const store = new MemorySessionStore();
    const orch = new AgentOrchestrator({ provider: new StubProvider(), store });
    const initial = orch.getSession();
    const first = await orch.createSession();
    const second = await orch.createSession();
    expect(second.id).not.toBe(first.id);

    const refreshed = await orch.openSession(first.id);
    expect(refreshed?.id).toBe(first.id);

    await orch.deleteSession(first.id);
    const ids = orch.listSessions().map((summary) => summary.id);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(first.id);
    expect(ids).toContain(second.id);
    expect(orch.getSession().id).toBe(initial.id);
  });

  it("persists and restores history after a simulated restart", async () => {
    const store = new MemorySessionStore();
    const orch = new AgentOrchestrator({
      provider: new StubProvider(),
      store,
    });
    const provider = new StubProvider();
    provider.rounds = [{ tokens: ["persisted answer"] }];
    orch.setProvider(provider);
    await orch.sendMessage("remember this");

    const sessions = await store.list();
    expect(sessions.length).toBe(1);
    expect(sessions[0].messages.some((message) => message.content === "remember this")).toBe(true);
    expect(sessions[0].modelName).toBe("stub-model");

    const restarted = new AgentOrchestrator({ provider: new StubProvider(), store });
    const summaries = await restarted.loadSessionsFromStore();
    expect(summaries.length).toBe(1);
    const active = restarted.getSession();
    expect(active.messages[0].content).toBe("remember this");
    expect(active.messages.some((message) => message.content === "persisted answer")).toBe(true);
  });

  it("renames a session and surfaces the title", async () => {
    const orch = new AgentOrchestrator({ provider: new StubProvider() });
    const session = await orch.createSession();
    await orch.renameSession(session.id, "Build zombie arena");
    expect(orch.getSessionSummary().title).toBe("Build zombie arena");
  });
});

describe("SessionManager persistence callback", () => {
  it("persists every mutation through the manager", () => {
    const saved: unknown[] = [];
    const manager = new SessionManager({
      persist: (session) => {
        saved.push(session);
      },
    });
    const session = manager.createSession("openai", "gpt-4o");
    manager.updateStatus(session.id, "thinking");
    manager.addMessage(session.id, {
      id: "m1",
      role: "user",
      content: "hello",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(saved.length).toBeGreaterThanOrEqual(2);
    const last = saved[saved.length - 1] as { messages: Array<{ content: string }> };
    expect(last.messages.at(-1)?.content).toBe("hello");
  });
});
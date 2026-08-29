import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "./orchestrator";
import { SimpleEventBus } from "./events";
import type { ChatRequest, ChatResponse, ModelProvider, StreamingEvent } from "@clpc/types";

class FakeProvider implements ModelProvider {
  readonly id = "fake";
  readonly displayName = "Fake";
  readonly modelName = "fake-model";
  readonly supportsStreaming = true;

  async complete(_request: ChatRequest): Promise<ChatResponse> {
    return { id: "x", content: "complete", modelId: this.id };
  }

  async *stream(_request: ChatRequest): AsyncIterable<StreamingEvent> {
    yield { type: "token", content: "Hel" };
    yield { type: "token", content: "lo" };
    yield { type: "done" };
  }
}

describe("AgentOrchestrator", () => {
  it("creates a session bound to the provider id", () => {
    const orch = new AgentOrchestrator({ provider: new FakeProvider() });
    const session = orch.getSession();
    expect(session.id).toBeTruthy();
    expect(session.modelId).toBe("fake");
    expect(session.status).toBe("idle");
  });

  it("appends user and assistant messages to the session on send", async () => {
    const bus = new SimpleEventBus();
    const orch = new AgentOrchestrator({ provider: new FakeProvider(), eventBus: bus });

    const tokens: string[] = [];
    bus.on("token", (data: { content: string }) => tokens.push(data.content));

    await orch.sendMessage("hello");

    const session = orch.getSession();
    expect(session.messages.length).toBe(2);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[0].content).toBe("hello");
    expect(session.messages[1].role).toBe("assistant");
    expect(session.messages[1].content).toBe("Hello");
    expect(session.status).toBe("completed");
    expect(tokens.join("")).toBe("Hello");
  });

  it("emits staged session status events in order", async () => {
    const bus = new SimpleEventBus();
    const orch = new AgentOrchestrator({ provider: new FakeProvider(), eventBus: bus });

    const statuses: string[] = [];
    bus.on("session_status", (data: { status: string }) => statuses.push(data.status));

    await orch.sendMessage("hello");

    expect(statuses[0]).toBe("thinking");
    expect(statuses).toContain("streaming");
    expect(statuses[statuses.length - 1]).toBe("completed");
  });

  it("emits error and sets status when the provider throws", async () => {
    const bus = new SimpleEventBus();
    const failing = new FakeProvider();
    failing.stream = async function* (_req: ChatRequest): AsyncIterable<StreamingEvent> {
      yield { type: "token", content: "x" };
      throw new Error("boom");
    };

    const orch = new AgentOrchestrator({ provider: failing, eventBus: bus });
    let sawError = false;
    let sawAgentError = false;
    bus.on("error", (data: { message: string }) => {
      if (data.message === "boom") sawError = true;
    });
    bus.on("agent_error", (data: { message: string; code: string }) => {
      if (data.message === "boom") {
        sawAgentError = true;
        expect(data.code).toBeDefined();
      }
    });

    await expect(orch.sendMessage("x")).rejects.toThrow("boom");
    expect(orch.getSession().status).toBe("failed");
    expect(sawError).toBe(true);
    expect(sawAgentError).toBe(true);
  });
});
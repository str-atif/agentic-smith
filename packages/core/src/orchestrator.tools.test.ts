import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "./orchestrator";
import { SimpleEventBus } from "./events";
import { ToolRegistry } from "@clpc/tools";
import type {
  ApprovalGate,
  ApprovalRequest,
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamingEvent,
  ToolCallRequest,
} from "@clpc/types";

class ScriptedProvider implements ModelProvider {
  readonly id = "scripted";
  readonly displayName = "Scripted";
  readonly modelName = "scripted-model";
  readonly supportsStreaming = true;

  rounds: Array<{
    tokens: string[];
    toolCalls: ToolCallRequest[];
  }> = [];
  private round = 0;

  async complete(_request: ChatRequest): Promise<ChatResponse> {
    return { id: "x", content: "complete", modelId: this.id };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamingEvent> {
    const seenTools = request.messages.filter((message) => message.role === "tool");
    if (seenTools.length === 1) {
      yield { type: "token", content: "Answer: " };
      yield { type: "token", content: "42" };
      yield { type: "done" };
      return;
    }
    if (this.round === 0) {
      this.round += 1;
      yield { type: "tool_call", toolCall: { id: "t1", name: "get_answer", arguments: { q: "meaning" } } };
      yield { type: "done" };
      return;
    }
    yield { type: "done" };
  }
}

describe("AgentOrchestrator tool loop", () => {
  it("executes tools and feeds results back to the model", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "get_answer",
      description: "Returns the meaning of life",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      requiresApproval: false,
      async execute(call) {
        return { ok: true, output: String(call.arguments?.q ?? "") + ":42", durationMs: 0 };
      },
    });

    const bus = new SimpleEventBus();
    const orch = new AgentOrchestrator({
      provider: new ScriptedProvider(),
      toolRegistry: registry,
      eventBus: bus,
    });

    const toolEvents: string[] = [];
    bus.on("tool_started", (data: { toolName: string }) => toolEvents.push(data.toolName));

    await orch.sendMessage("what is the meaning of life?");

    const session = orch.getSession();
    const toolMessages = session.messages.filter((message) => message.role === "tool");
    expect(toolMessages.length).toBe(1);
    expect(toolMessages[0].content).toBe("meaning:42");

    const roles = session.messages.map((message) => message.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);

    const assistant = session.messages.filter((message) => message.role === "assistant");
    expect(assistant[0].toolCalls).toHaveLength(1);
    expect(assistant[1].content).toBe("Answer: 42");
    expect(toolEvents).toContain("get_answer");
    expect(session.status).toBe("completed");
  });

  it("requests approval for tools that require it and passes the result", async () => {
    let requested: ApprovalRequest | null = null;
    const gate: ApprovalGate = {
      async requestApproval(request) {
        requested = request;
        return "approved";
      },
    };

    const registry = new ToolRegistry();
    registry.register({
      name: "danger",
      description: "Needs approval",
      parameters: { type: "object", properties: {} },
      requiresApproval: true,
      async execute() {
        return { ok: true, output: "done-danger", durationMs: 0 };
      },
    });

    class DangerProvider extends ScriptedProvider {
      stream = async function* (req: ChatRequest): AsyncIterable<StreamingEvent> {
        const hasTool = req.messages.some((message) => message.role === "tool");
        if (hasTool) {
          yield { type: "token", content: "handled" };
          yield { type: "done" };
          return;
        }
        yield { type: "tool_call", toolCall: { id: "t2", name: "danger" } };
        yield { type: "done" };
      };
    }

    const bus = new SimpleEventBus();
    const orch = new AgentOrchestrator({
      provider: new DangerProvider(),
      toolRegistry: registry,
      approvalGate: gate,
      eventBus: bus,
    });

    const approvals: string[] = [];
    bus.on("approval_requested", (data: { approvalId: string; toolName: string }) => {
      approvals.push(data.toolName);
    });

    await orch.sendMessage("run the danger tool");

    expect((requested as unknown as ApprovalRequest).toolCall.name).toBe("danger");
    expect(approvals).toContain("danger");

    const toolMessages = orch.getSession().messages.filter((message) => message.role === "tool");
    expect(toolMessages.some((message) => message.content === "done-danger")).toBe(true);
  });

  it("skips execution when a tool call is denied", async () => {
    const gate: ApprovalGate = {
      async requestApproval() {
        return "denied";
      },
    };
    let executed = false;
    const registry = new ToolRegistry();
    registry.register({
      name: "denied_tool",
      description: "Denied",
      parameters: { type: "object", properties: {} },
      requiresApproval: true,
      async execute() {
        executed = true;
        return { ok: true, output: "ran", durationMs: 0 };
      },
    });

    class DeniedProvider extends ScriptedProvider {
      stream = async function* (req: ChatRequest): AsyncIterable<StreamingEvent> {
        if (req.messages.some((message) => message.role === "tool")) {
          yield { type: "done" };
          return;
        }
        yield { type: "tool_call", toolCall: { id: "t3", name: "denied_tool" } };
        yield { type: "done" };
      };
    }

    const orch = new AgentOrchestrator({
      provider: new DeniedProvider(),
      toolRegistry: registry,
      approvalGate: gate,
    });

    await orch.sendMessage("do it");
    expect(executed).toBe(false);
    const toolMessages = orch.getSession().messages.filter((message) => message.role === "tool");
    expect(toolMessages[0].content).toMatch(/denied/);
  });

  it("stops after maxIterations rounds", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "loop_tool",
      description: "Always asks again",
      parameters: { type: "object", properties: {} },
      requiresApproval: false,
      async execute() {
        return { ok: true, output: "again", durationMs: 0 };
      },
    });

    class LoopProvider extends ScriptedProvider {
      stream = async function* (): AsyncIterable<StreamingEvent> {
        yield { type: "tool_call", toolCall: { id: "t" + Math.random(), name: "loop_tool" } };
        yield { type: "done" };
      };
    }

    const orch = new AgentOrchestrator({
      provider: new LoopProvider(),
      toolRegistry: registry,
      maxIterations: 2,
    });

    await orch.sendMessage("loop");
    const toolMessages = orch.getSession().messages.filter((message) => message.role === "tool");
    expect(toolMessages.length).toBe(2);
  });
});
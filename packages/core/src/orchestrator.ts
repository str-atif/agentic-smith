import {
  AgentSession,
  ApprovalGate,
  ApprovalStatus,
  ChatTool,
  Message,
  ModelProvider,
  ToolCallRequest,
} from "@clpc/types";
import {
  ToolRegistry,
  ToolLifecycleEvent,
} from "@clpc/tools";
import { SessionManager } from "./session";
import { EventBus, SimpleEventBus } from "./events";
import { AutoApproveGate } from "./approval";

export interface AgentOrchestratorOptions {
  provider: ModelProvider;
  sessionId?: string;
  eventBus?: EventBus;
  toolRegistry?: ToolRegistry;
  tools?: Array<{ name: string; description: string }>;
  approvalGate?: ApprovalGate;
  maxIterations?: number;
}

function toChatTool(tool: { name: string; description?: string }): ChatTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: { type: "object", properties: {} },
    },
  };
}

export class AgentOrchestrator {
  readonly sessionId: string;
  readonly sessionManager: SessionManager;
  private eventBus: EventBus;
  private provider: ModelProvider;
  private toolRegistry?: ToolRegistry;
  private approvalGate: ApprovalGate;
  private maxIterations: number;

  constructor(options: AgentOrchestratorOptions) {
    this.provider = options.provider;
    this.eventBus = options.eventBus ?? new SimpleEventBus();
    this.sessionManager = new SessionManager();
    this.toolRegistry = options.toolRegistry;
    this.approvalGate = options.approvalGate ?? new AutoApproveGate();
    this.maxIterations = options.maxIterations ?? 6;

    if (options.sessionId) {
      this.sessionId = options.sessionId;
      this.sessionManager.attachSession(this.sessionId, this.provider.id, this.provider.modelName);
    } else {
      const session = this.sessionManager.createSession(this.provider.id, this.provider.modelName);
      this.sessionId = session.id;
    }

    this.eventBus.emit("session_created", this.getSession());
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  getSession(): AgentSession {
    const session = this.sessionManager.getSession(this.sessionId);
    if (!session) {
      throw new Error(`Session "${this.sessionId}" not found`);
    }
    return session;
  }

  setProvider(provider: ModelProvider): void {
    this.provider = provider;
    this.sessionManager.updateProvider(this.sessionId, provider.id, provider.modelName);
    this.emitStatus();
  }

  async sendMessage(content: string): Promise<void> {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    this.sessionManager.addMessage(this.sessionId, userMessage);
    this.eventBus.emit("message_received", userMessage);
    this.sessionManager.updateStatus(this.sessionId, "thinking");
    this.emitStatus();

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };
    this.sessionManager.addMessage(this.sessionId, assistantMessage);

    try {
      let currentAssistantMessage = assistantMessage;
      let availableTools = this.getRegisteredTools();

      for (let iteration = 0; iteration < this.maxIterations; iteration++) {
        this.sessionManager.updateStatus(this.sessionId, "streaming");
        this.emitStatus();

        const { full, toolCalls } = await this.streamRound(
          availableTools
        );

        currentAssistantMessage.content = full;
        currentAssistantMessage.toolCalls = toolCalls;

        if (toolCalls.length === 0) {
          break;
        }

        this.eventBus.emit("response_complete", currentAssistantMessage);

        const completedTools = await this.executeTools(toolCalls);
        if (completedTools) {
          availableTools = completedTools;
        }

        if (iteration + 1 >= this.maxIterations) {
          break;
        }

        currentAssistantMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
        };
        this.sessionManager.addMessage(this.sessionId, currentAssistantMessage);
      }

      this.sessionManager.updateStatus(this.sessionId, "idle");
      this.emitStatus();
      this.eventBus.emit("response_complete", currentAssistantMessage);
    } catch (error) {
      this.sessionManager.updateStatus(this.sessionId, "error");
      this.emitStatus();
      const message = error instanceof Error ? error.message : String(error);
      this.eventBus.emit("error", { sessionId: this.sessionId, message });
      throw error;
    }
  }

  private async streamRound(availableTools: ChatTool[]): Promise<{
    full: string;
    toolCalls: ToolCallRequest[];
  }> {
    const history = this.getSession().messages;
    const request = {
      messages: history,
      modelId: this.provider.id,
      stream: true,
      tools: availableTools,
    };

    let full = "";
    const toolCalls: ToolCallRequest[] = [];

    for await (const event of this.provider.stream(request)) {
      if (event.type === "token" && event.content) {
        full += event.content;
        this.emitToken(event.content);
      } else if (event.type === "tool_call" && event.toolCall) {
        toolCalls.push(event.toolCall);
      } else if (event.type === "error" && event.error) {
        throw new Error(event.error);
      }
    }

    return { full, toolCalls };
  }

  private emitToken(content: string): void {
    const messages = this.getSession().messages;
    const assistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (assistantMessage) {
      this.eventBus.emit("token", {
        sessionId: this.sessionId,
        messageId: assistantMessage.id,
        content,
      });
    }
  }

  private async executeTools(
    calls: ToolCallRequest[]
  ): Promise<ChatTool[] | undefined> {
    if (!this.toolRegistry) {
      const errors = calls.map((call) =>
        this.appendToolResult(call.id, "", `No tool registry configured`, false)
      );
      await Promise.all(errors);
      return undefined;
    }

    const invoker = this.toolRegistry.createInvoker({
      onLifecycle: (event) => this.bridgeLifecycle(event),
    });

    for (const call of calls) {
      const tool = this.toolRegistry.find(call.name);
      if (!tool) {
        await this.appendToolResult(
          call.id,
          "",
          `Unknown tool: ${call.name}`,
          false
        );
        continue;
      }

      if (tool.requiresApproval) {
        const status = await this.requestApproval(call);
        if (status === "denied") {
          await this.appendToolResult(
            call.id,
            "",
            `Tool "${call.name}" was denied by the user`,
            false
          );
          continue;
        }
      }

      const result = await invoker.invoke(call);
      await this.appendToolResult(
        call.id,
        result.output,
        result.error,
        result.ok
      );
    }

    return this.getRegisteredTools();
  }

  private appendToolResult(
    toolCallId: string,
    output: unknown,
    error: string | undefined,
    ok: boolean
  ): Promise<void> {
    const content = ok
      ? typeof output === "string"
        ? output
        : JSON.stringify(output)
      : error ?? "Tool failed";
    const message: Message = {
      id: crypto.randomUUID(),
      role: "tool",
      toolCallId,
      content,
      timestamp: new Date().toISOString(),
    };
    this.sessionManager.addMessage(this.sessionId, message);
    this.eventBus.emit("message_received", message);
    return Promise.resolve();
  }

  private async requestApproval(call: ToolCallRequest): Promise<ApprovalStatus> {
    const approvalId = crypto.randomUUID();
    const reason = `Tool "${call.name}" requires approval`;
    this.eventBus.emit("approval_requested", {
      sessionId: this.sessionId,
      approvalId,
      toolName: call.name,
      reason,
    });
    return this.approvalGate.requestApproval({
      id: approvalId,
      toolCall: call,
      reason,
      createdAt: new Date().toISOString(),
    });
  }

  private bridgeLifecycle(event: ToolLifecycleEvent): void {
    this.eventBus.emit(event.type, event);
  }

  private getRegisteredTools(): ChatTool[] {
    if (!this.toolRegistry) return [];
    return this.toolRegistry.list().map(toChatTool);
  }

  private emitStatus(): void {
    this.eventBus.emit("session_status", {
      sessionId: this.sessionId,
      status: this.getSession().status,
    });
  }
}
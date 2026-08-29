import {
  AgentSession,
  ApprovalGate,
  ApprovalStatus,
  ChatTool,
  Message,
  ModelProvider,
  SessionStatus,
  SessionSummary,
  ToolCallRequest,
} from "@clpc/types";
import {
  ToolRegistry,
  ToolLifecycleEvent,
} from "@clpc/tools";
import { SessionManager } from "./session";
import { EventBus, SimpleEventBus } from "./events";
import { AutoApproveGate } from "./approval";
import { SessionStore, toSessionSummary } from "./store";

export interface AgentOrchestratorOptions {
  provider: ModelProvider;
  sessionId?: string;
  eventBus?: EventBus;
  toolRegistry?: ToolRegistry;
  tools?: Array<{ name: string; description: string }>;
  approvalGate?: ApprovalGate;
  maxIterations?: number;
  toolTimeoutMs?: number;
  store?: SessionStore;
}

export class AgentBusyError extends Error {
  constructor() {
    super("The agent is still working on the previous request");
    this.name = "AgentBusyError";
  }
}

const STAGE_LABEL: Record<SessionStatus, string> = {
  idle: "Idle",
  thinking: "Thinking…",
  streaming: "Generating response…",
  executing_tool: "Running tool…",
  waiting_for_tool: "Waiting for approval…",
  continuing: "Continuing…",
  completed: "Completed",
  failed: "Failed",
  error: "Error",
};

export function toChatTool(tool: { name: string; description?: string }): ChatTool {
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
  readonly sessionManager: SessionManager;
  private eventBus: EventBus;
  private provider: ModelProvider;
  private toolRegistry?: ToolRegistry;
  private approvalGate: ApprovalGate;
  private maxIterations: number;
  private toolTimeoutMs: number;
  private store?: SessionStore;
  private sessionId: string;

  constructor(options: AgentOrchestratorOptions) {
    this.provider = options.provider;
    this.eventBus = options.eventBus ?? new SimpleEventBus();
    this.toolRegistry = options.toolRegistry;
    this.approvalGate = options.approvalGate ?? new AutoApproveGate();
    this.maxIterations = options.maxIterations ?? 6;
    this.toolTimeoutMs = options.toolTimeoutMs ?? 120_000;
    this.store = options.store;
    this.sessionManager = new SessionManager({
      persist: options.store ? (session) => this.store?.save(session) : undefined,
    });

    if (options.sessionId) {
      this.sessionId = options.sessionId;
      this.sessionManager.attachSession(this.sessionId, this.provider.id, this.provider.modelName);
    } else {
      const session = this.sessionManager.createSession(this.provider.id, this.provider.modelName);
      this.sessionId = session.id;
    }

    this.eventBus.emit("session_created", this.getSession());
  }

  async loadSessionsFromStore(): Promise<SessionSummary[]> {
    if (!this.store) return this.listSessions();
    const sessions = await this.store.list();
    const loadedIds = new Set(sessions.map((session) => session.id));
    for (const existing of this.sessionManager.listSessions()) {
      if (!loadedIds.has(existing.id) && existing.messages.length === 0) {
        this.sessionManager.remove(existing.id);
      }
    }
    for (const session of sessions) {
      this.sessionManager.restore(this.ensureSessionShape(session));
    }
    if (sessions.length > 0) {
      this.sessionId = sessions[0].id;
      this.eventBus.emit("session_created", this.getSession());
    }
    return this.listSessions();
  }

  async openSession(id: string): Promise<AgentSession | null> {
    let session = this.sessionManager.getSession(id);
    if (!session && this.store) {
      const loaded = await this.store.load(id);
      if (!loaded) return null;
      session = this.sessionManager.restore(this.ensureSessionShape(loaded));
    } else if (!session) {
      session = this.sessionManager.attachSession(id, this.provider.id, this.provider.modelName);
    }
    if (session) {
      this.sessionId = session.id;
      this.eventBus.emit("session_created", session);
    }
    return session;
  }

  async createSession(): Promise<AgentSession> {
    const session = this.sessionManager.createSession(this.provider.id, this.provider.modelName);
    this.sessionId = session.id;
    this.eventBus.emit("session_created", session);
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    const wasActive = id === this.sessionId;
    await this.store?.delete(id);
    this.sessionManager.remove(id);
    if (wasActive) {
      const remaining = this.listSessions();
      if (remaining.length > 0) {
        await this.openSession(remaining[0].id);
      } else {
        await this.createSession();
      }
    }
  }

  async renameSession(id: string, title: string): Promise<void> {
    const session = this.sessionManager.getSession(id);
    if (session) {
      session.title = title.trim() || "New conversation";
      session.updatedAt = new Date().toISOString();
      await this.store?.save(session);
      this.emitSessionUpdated(session);
    }
  }

  listSessions(): SessionSummary[] {
    return this.sessionManager.listSessions().map(toSessionSummary);
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

  getSessionSummary(): SessionSummary {
    return toSessionSummary(this.getSession());
  }

  setProvider(provider: ModelProvider): void {
    this.provider = provider;
    this.sessionManager.updateProvider(this.sessionId, provider.id, provider.modelName);
    this.emitSessionUpdated(this.getSession());
    this.emitStatus();
  }

  protected setTaskState(status: SessionStatus, stage?: string): void {
    this.sessionManager.updateStatus(this.sessionId, status);
    this.eventBus.emit("session_status", {
      sessionId: this.sessionId,
      status,
      stage: stage ?? STAGE_LABEL[status],
    });
    this.emitSessionUpdated(this.getSession());
  }

  async sendMessage(content: string, clientMessageId?: string): Promise<void> {
    const currentStatus = this.getSession().status;
    if (
      currentStatus === "thinking" ||
      currentStatus === "streaming" ||
      currentStatus === "executing_tool" ||
      currentStatus === "waiting_for_tool" ||
      currentStatus === "continuing"
    ) {
      throw new AgentBusyError();
    }

    const userMessage: Message = {
      id: clientMessageId ?? crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    this.sessionManager.addMessage(this.sessionId, userMessage);
    this.eventBus.emit("message_received", userMessage);

    this.setTaskState("thinking", "Thinking…");
    const assistantMessage = this.newAssistantMessage();
    this.eventBus.emit("message_received", assistantMessage);

    let currentAssistantMessage = assistantMessage;
    try {
      let availableTools = this.getRegisteredTools();

      for (let iteration = 0; iteration < this.maxIterations; iteration++) {
        this.setTaskState("streaming", "Generating response…");

        const { full, toolCalls } = await this.streamRound(availableTools);

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

        this.setTaskState("continuing", "Continuing…");
        currentAssistantMessage = this.newAssistantMessage();
        this.eventBus.emit("message_received", currentAssistantMessage);
      }

      this.setTaskState("completed", "Completed");
      this.eventBus.emit("response_complete", currentAssistantMessage);
    } catch (error) {
      this.handleAgentError(error);
      this.eventBus.emit("response_complete", currentAssistantMessage);
      throw error;
    }
  }

  private newAssistantMessage(): Message {
    const message: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };
    this.sessionManager.addMessage(this.sessionId, message);
    return message;
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
        this.appendToolResult(call.id, "", `No tool registry configured`, false, "tool_execution")
      );
      await Promise.all(errors);
      return undefined;
    }

    const invoker = this.toolRegistry.createInvoker({
      timeoutMs: this.toolTimeoutMs,
      onLifecycle: (event) => this.bridgeLifecycle(event),
    });

    for (const call of calls) {
      const tool = this.toolRegistry.find(call.name);
      if (!tool) {
        await this.appendToolResult(
          call.id,
          "",
          `Unknown tool: ${call.name}`,
          false,
          "unknown"
        );
        continue;
      }

      if (tool.requiresApproval) {
        this.setTaskState("waiting_for_tool", `Waiting for approval of ${call.name}…`);
        const status = await this.requestApproval(call);
        if (status === "denied") {
          await this.appendToolResult(
            call.id,
            "",
            `Tool "${call.name}" was denied by the user`,
            false,
            "permission"
          );
          continue;
        }
      }

      this.setTaskState("executing_tool", `Running ${call.name}…`);
      const result = await invoker.invoke(call);
      await this.appendToolResult(
        call.id,
        result.output,
        result.error,
        result.ok,
        result.code
      );
    }

    return this.getRegisteredTools();
  }

  private appendToolResult(
    toolCallId: string,
    output: unknown,
    error: string | undefined,
    ok: boolean,
    code?: string
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
      metadata: code ? { errorCode: code } : undefined,
    };
    this.sessionManager.addMessage(this.sessionId, message);
    this.eventBus.emit("message_received", message);
    if (!ok) {
      this.eventBus.emit("agent_error", {
        sessionId: this.sessionId,
        code: this.normalizeToolCode(code),
        kind: "tool",
        message: error || "Tool failed",
        detail: { toolCallId },
      });
    }
    return Promise.resolve();
  }

  private normalizeToolCode(code: string | undefined): "tool_validation" | "tool_execution" | "mcp_connection" | "timeout" | "permission" | "unknown" {
    switch (code) {
      case "tool_validation":
      case "tool_execution":
      case "mcp_connection":
      case "timeout":
      case "permission":
        return code;
      default:
        return "unknown";
    }
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

  private handleAgentError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const code = this.mapErrorCode(error, message);
    this.setTaskState("failed", code === "timeout" ? "Timed out" : "Failed");
    this.eventBus.emit("agent_error", {
      sessionId: this.sessionId,
      code,
      kind: "agent",
      message,
    });
    this.eventBus.emit("error", { sessionId: this.sessionId, message });
  }

  private mapErrorCode(
    _error: unknown,
    message: string
  ): "timeout" | "model" | "unknown" | "tool_validation" {
    const text = message.toLowerCase();
    if (/\btimed out\b|timeouterror|idle timeout|aborted/.test(text)) {
      return "timeout";
    }
    if (/invalid arguments|validation/.test(text)) {
      return "tool_validation";
    }
    if (/api error|network|fetch|econn|unauth|401|403|429|404|500|failed to/.test(text)) {
      return "model";
    }
    return "model";
  }

  private getRegisteredTools(): ChatTool[] {
    if (!this.toolRegistry) return [];
    return this.toolRegistry.list().map(toChatTool);
  }

  private emitStatus(): void {
    const session = this.getSession();
    this.eventBus.emit("session_status", {
      sessionId: this.sessionId,
      status: session.status,
      stage: STAGE_LABEL[session.status],
    });
    this.emitSessionUpdated(session);
  }

  private emitSessionUpdated(session: AgentSession): void {
    this.eventBus.emit("session_updated", {
      sessionId: session.id,
      summary: toSessionSummary(session),
    });
  }

  private ensureSessionShape(session: AgentSession): AgentSession {
    return {
      ...session,
      title: session.title || "New conversation",
      status: session.status ?? "idle",
      messages: Array.isArray(session.messages) ? session.messages : [],
    };
  }
}
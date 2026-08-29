export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  messages: Message[];
  modelId: string;
  stream?: boolean;
  tools?: ChatTool[];
}

export interface ChatResponse {
  id: string;
  content: string;
  modelId: string;
  toolCalls?: ToolCallRequest[];
}

export interface StreamingEvent {
  type: "token" | "done" | "error" | "tool_call";
  content?: string;
  toolCall?: ToolCallRequest;
  error?: string;
}

export interface ModelProvider {
  readonly id: string;
  readonly displayName: string;
  readonly modelName: string;
  readonly supportsStreaming: boolean;
  complete(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamingEvent>;
}

export type TaskStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "executing_tool"
  | "waiting_for_tool"
  | "continuing"
  | "completed"
  | "failed"
  | "error";

export type SessionStatus = TaskStatus;

export interface AgentSession {
  id: string;
  messages: Message[];
  modelId: string;
  modelName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt?: string;
  title?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  modelId: string;
  modelName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export type ToolErrorCode =
  | "tool_validation"
  | "tool_execution"
  | "mcp_connection"
  | "timeout"
  | "permission"
  | "unknown";

export interface ModelProviderConfig {
  providerId: string;
  apiKey?: string;
  modelName: string;
  baseUrl?: string;
  label?: string;
  orgId?: string;
  projectId?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  streaming?: boolean;
}

export interface ProviderPreset {
  id: string;
  displayName: string;
  providerId: string;
  modelName: string;
  baseUrl?: string;
  apiKey?: string;
  orgId?: string;
  projectId?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  streaming?: boolean;
}

export type ProviderPresetView = Omit<ProviderPreset, "apiKey"> & {
  hasApiKey: boolean;
};

export type ProviderPresetDraft = Omit<ProviderPreset, "id"> & {
  id?: string;
};

export interface ModelProviderPresetInfo {
  id: string;
  displayName: string;
  providerId: string;
  baseUrl?: string;
  apiKeyOptional?: boolean;
}

export interface ModelConnectionTestResult {
  ok: boolean;
  endpoint?: string;
  model?: string;
  latencyMs?: number;
  streaming?: boolean;
  message: string;
}

export type CraftlandConnectionState =
  | "unavailable"
  | "detecting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

export interface CraftlandInfo {
  state: CraftlandConnectionState;
  pid?: number;
  port?: number;
  endpoint?: string;
  toolCount?: number;
  project?: string;
  scene?: string;
  serverName?: string;
  error?: string;
  lastUpdated?: string;
}

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface ApprovalRequest {
  id: string;
  toolCall: ToolCallRequest;
  reason: string;
  createdAt: string;
}

export interface ApprovalGate {
  requestApproval(request: ApprovalRequest): Promise<ApprovalStatus>;
}
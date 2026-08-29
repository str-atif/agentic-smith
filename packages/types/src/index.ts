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

export type SessionStatus = "idle" | "thinking" | "streaming" | "error";

export interface AgentSession {
  id: string;
  messages: Message[];
  modelId: string;
  modelName: string;
  status: SessionStatus;
  createdAt: string;
}

export interface ModelProviderConfig {
  providerId: string;
  apiKey?: string;
  modelName: string;
  baseUrl?: string;
  label?: string;
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
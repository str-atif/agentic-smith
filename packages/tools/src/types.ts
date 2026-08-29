import type { ToolCallRequest, ToolErrorCode } from "@clpc/types";

export interface ToolContext {
  sessionId?: string;
}

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  code?: ToolErrorCode;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  execute(call: ToolCallRequest, ctx: ToolContext): Promise<ToolResult>;
}

export type ToolLifecycleEvent =
  | { type: "tool_started"; callId: string; toolName: string; timestamp: string }
  | { type: "tool_progress"; callId: string; message: string; timestamp: string }
  | { type: "tool_completed"; callId: string; result: ToolResult; timestamp: string }
  | {
      type: "tool_failed";
      callId: string;
      error: string;
      code?: ToolErrorCode;
      timestamp: string;
    };

export { ToolCallRequest, ToolErrorCode };
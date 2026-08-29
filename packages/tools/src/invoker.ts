import Ajv from "ajv";
import type { ToolCallRequest } from "@clpc/types";
import { Tool, ToolContext, ToolLifecycleEvent, ToolResult } from "./types";
import { ToolRegistry } from "./registry";

export interface ToolInvokerOptions {
  onLifecycle?: (event: ToolLifecycleEvent) => void;
}

export class ToolInvoker {
  private readonly registry: ToolRegistry;
  private readonly onLifecycle?: (event: ToolLifecycleEvent) => void;
  private readonly ajv: Ajv;

  constructor(registry: ToolRegistry, options: ToolInvokerOptions = {}) {
    this.registry = registry;
    this.onLifecycle = options.onLifecycle;
    this.ajv = new Ajv({ allErrors: true, strict: false });
  }

  async invoke(call: ToolCallRequest, ctx?: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now();
    const tool = this.registry.find(call.name);

    if (!tool) {
      return this.fail(call, startedAt, `Unknown tool "${call.name}"`);
    }

    const validation = this.validateArguments(tool, call);
    if (!validation.valid) {
      const error = `Invalid arguments for "${call.name}": ${validation.errors.join("; ")}`;
      return this.fail(call, startedAt, error);
    }

    this.emit({ type: "tool_started", callId: call.id, toolName: tool.name, timestamp: new Date().toISOString() });

    try {
      const result = await tool.execute(call, ctx ?? {});
      const timed: ToolResult = { ...result, durationMs: Date.now() - startedAt };
      if (timed.ok) {
        this.emit({ type: "tool_completed", callId: call.id, result: timed, timestamp: new Date().toISOString() });
      } else {
        this.emit({ type: "tool_failed", callId: call.id, error: timed.error || "Tool returned failure", timestamp: new Date().toISOString() });
      }
      return timed;
    } catch (error) {
      return this.fail(call, startedAt, error instanceof Error ? error.message : String(error));
    }
  }

  private validateArguments(
    tool: Tool,
    call: ToolCallRequest
  ): { valid: boolean; errors: string[] } {
    const schema = tool.parameters ?? { type: "object", properties: {} };
    const validate = this.ajv.compile(schema);
    const valid = validate(call.arguments ?? {});
    if (valid) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`),
    };
  }

  private fail(call: ToolCallRequest, startedAt: number, error: string): ToolResult {
    const result: ToolResult = { ok: false, error, durationMs: Date.now() - startedAt };
    this.emit({ type: "tool_failed", callId: call.id, error, timestamp: new Date().toISOString() });
    return result;
  }

  private emit(event: ToolLifecycleEvent): void {
    this.onLifecycle?.(event);
  }
}
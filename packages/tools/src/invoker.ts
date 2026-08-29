import Ajv from "ajv";
import type { ToolCallRequest, ToolErrorCode } from "@clpc/types";
import { Tool, ToolContext, ToolLifecycleEvent, ToolResult } from "./types";
import { ToolRegistry } from "./registry";

export interface ToolInvokerOptions {
  onLifecycle?: (event: ToolLifecycleEvent) => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class ToolInvoker {
  private readonly registry: ToolRegistry;
  private readonly onLifecycle?: (event: ToolLifecycleEvent) => void;
  private readonly timeoutMs: number;
  private readonly ajv: Ajv;

  constructor(registry: ToolRegistry, options: ToolInvokerOptions = {}) {
    this.registry = registry;
    this.onLifecycle = options.onLifecycle;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.ajv = new Ajv({ allErrors: true, strict: false });
  }

  async invoke(call: ToolCallRequest, ctx?: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now();
    const tool = this.registry.find(call.name);

    if (!tool) {
      return this.fail(call, startedAt, `Unknown tool "${call.name}"`, "unknown");
    }

    const validation = this.validateArguments(tool, call);
    if (!validation.valid) {
      const error = `Invalid arguments for "${call.name}": ${validation.errors.join("; ")}`;
      return this.fail(call, startedAt, error, "tool_validation");
    }

    this.emit({ type: "tool_started", callId: call.id, toolName: tool.name, timestamp: new Date().toISOString() });

    try {
      const result = await withTimeout(tool.execute(call, ctx ?? {}), this.timeoutMs, call.name);
      const timed: ToolResult = { ...result, durationMs: Date.now() - startedAt };
      if (timed.ok) {
        this.emit({ type: "tool_completed", callId: call.id, result: timed, timestamp: new Date().toISOString() });
      } else {
        this.emit({
          type: "tool_failed",
          callId: call.id,
          error: timed.error || "Tool returned failure",
          code: timed.code ?? "tool_execution",
          timestamp: new Date().toISOString(),
        });
      }
      return timed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code: ToolErrorCode =
        message.startsWith(`${call.name} timed out`) || /timed out after/.test(message)
          ? "timeout"
          : "tool_execution";
      return this.fail(call, startedAt, message, code);
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

  private fail(
    call: ToolCallRequest,
    startedAt: number,
    error: string,
    code: ToolErrorCode = "tool_execution"
  ): ToolResult {
    const result: ToolResult = { ok: false, error, code, durationMs: Date.now() - startedAt };
    this.emit({ type: "tool_failed", callId: call.id, error, code, timestamp: new Date().toISOString() });
    return result;
  }

  private emit(event: ToolLifecycleEvent): void {
    this.onLifecycle?.(event);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      }
    );
  });
}
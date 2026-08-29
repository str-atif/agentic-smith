import { ToolCallRequest, ToolContext, ToolResult, ToolRegistry, Tool } from "@clpc/tools";
import { McpClient, McpToolDefinition } from "./types";

export interface McpToolRegistrationOptions {
  serverId?: string;
}

function sanitizePart(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function buildMcpToolKey(serverId: string, toolName: string): string {
  return `mcp_${sanitizePart(serverId)}_${sanitizePart(toolName)}`;
}

export function mcpToolToClpcTool(
  definition: McpToolDefinition,
  client: Pick<McpClient, "callTool">,
  serverId: string
): Tool {
  const name = buildMcpToolKey(serverId, definition.name);

  async function execute(call: ToolCallRequest, _ctx: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now();
    try {
      const result = await client.callTool(definition.name, call.arguments ?? {});
      const text = (result.content ?? [])
        .map((item) => item.text ?? "")
        .filter((item) => item.length > 0)
        .join("\n");
      const output = text || result.content;
      if (result.isError) {
        return {
          ok: false,
          error: text || "MCP tool returned an error",
          output,
          durationMs: Date.now() - startedAt,
        };
      }
      return { ok: true, output, durationMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  return {
    name,
    description: definition.description ?? `MCP tool: ${definition.name}`,
    parameters: definition.inputSchema ?? { type: "object", properties: {} },
    requiresApproval: false,
    execute,
  };
}

export async function registerMcpTools(
  client: Pick<McpClient, "listTools" | "callTool" | "info">,
  registry: ToolRegistry,
  options: McpToolRegistrationOptions = {}
): Promise<string[]> {
  const serverId = options.serverId ?? client.info?.name ?? "mcp";
  const definitions = await client.listTools();
  const names: string[] = [];

  for (const definition of definitions) {
    const tool = mcpToolToClpcTool(definition, client, serverId);
    registry.register(tool);
    names.push(tool.name);
  }
  return names;
}
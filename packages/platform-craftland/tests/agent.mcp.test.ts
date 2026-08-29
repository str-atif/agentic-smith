import { AgentOrchestrator, SimpleEventBus } from "@clpc/core";
import { createMcpClient, registerMcpTools } from "@clpc/mcp-client";
import { ToolRegistry } from "@clpc/tools";
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamingEvent,
  ToolCallRequest,
} from "@clpc/types";
import { afterEach, describe, expect, it } from "vitest";
import { createStubMcpServer, StubMcpServer } from "./stub";

let servers: StubMcpServer[] = [];

function track(server: StubMcpServer): StubMcpServer {
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers) {
    await server.close().catch(() => {});
  }
  servers = [];
});

class CraftlandAgentProvider implements ModelProvider {
  readonly id = "craftland-agent";
  readonly displayName = "Craftland Agent Test";
  readonly modelName = "test-model";
  readonly supportsStreaming = true;

  async complete(_request: ChatRequest): Promise<ChatResponse> {
    return { id: "x", content: "", modelId: this.id };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamingEvent> {
    const toolMessages = request.messages.filter((message) => message.role === "tool");
    if (toolMessages.length > 0) {
      yield { type: "token", content: "Spawn point placed at the map center." };
      yield { type: "done" };
      return;
    }
    const toolCall: ToolCallRequest = {
      id: "spawn-1",
      name: "mcp_craftland_set_spawn_point",
      arguments: { position: { x: 0, y: 0, z: 0 } },
    };
    yield { type: "tool_call", toolCall };
    yield { type: "done" };
  }
}

describe("agent + Craftland MCP tools end to end", () => {
  it("places a spawn point through the MCP tool and answers", async () => {
    const server = track(
      await createStubMcpServer({
        tools: [
          {
            name: "set_spawn_point",
            description: "Set the spawn point for the current map",
            inputSchema: {
              type: "object",
              properties: { position: { type: "object" } },
            },
            handler(args) {
              const position = (args.position ?? {}) as Record<string, unknown>;
              return { status: "set", position };
            },
          },
        ],
      })
    );
    const client = createMcpClient({
      id: "craftland",
      name: "FE Demo",
      transport: "http",
      url: server.url,
    });
    await client.connect();

    const registry = new ToolRegistry();
    const names = await registerMcpTools(client, registry, { serverId: "craftland" });
    expect(names).toContain("mcp_craftland_set_spawn_point");

    const bus = new SimpleEventBus();
    const orchestrator = new AgentOrchestrator({
      provider: new CraftlandAgentProvider(),
      toolRegistry: registry,
      eventBus: bus,
    });

    const toolEvents: string[] = [];
    bus.on("tool_started", (data: { toolName: string }) => toolEvents.push(data.toolName));

    await orchestrator.sendMessage(
      "Put a spawn point in the center of the current map"
    );

    const session = orchestrator.getSession();
    const toolMessages = session.messages.filter((message) => message.role === "tool");

    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toContain('"position"');
    expect(toolMessages[0].content).toContain('"x":0');
    expect(toolMessages[0].content).toContain('"y":0');
    expect(toolMessages[0].content).toContain('"z":0');

    const assistantMessages = session.messages.filter(
      (message) => message.role === "assistant"
    );
    expect(assistantMessages[assistantMessages.length - 1].content).toContain(
      "Spawn point placed"
    );
    expect(toolEvents).toContain("mcp_craftland_set_spawn_point");

    await client.disconnect();
  });

  it("fails cleanly when the MCP tool is not registered", async () => {
    class MissingToolProvider implements ModelProvider {
      readonly id = "missing";
      readonly displayName = "Missing Tool";
      readonly modelName = "test-model";
      readonly supportsStreaming = true;

      async complete(_request: ChatRequest): Promise<ChatResponse> {
        return { id: "x", content: "", modelId: this.id };
      }

      async *stream(_request: ChatRequest): AsyncIterable<StreamingEvent> {
        yield {
          type: "tool_call",
          toolCall: {
            id: "ghost-1",
            name: "mcp_craftland_set_spawn_point",
            arguments: { position: { x: 0, y: 0, z: 0 } },
          },
        };
        yield { type: "done" };
      }
    }

    const registry = new ToolRegistry();
    const orchestrator = new AgentOrchestrator({
      provider: new MissingToolProvider(),
      toolRegistry: registry,
      maxIterations: 2,
    });

    await orchestrator.sendMessage("place a spawn point");

    const session = orchestrator.getSession();
    const toolMessages = session.messages.filter((message) => message.role === "tool");
    expect(toolMessages).toHaveLength(2);
    for (const toolMessage of toolMessages) {
      expect(toolMessage.content).toMatch(/unknown tool/i);
    }
    expect(session.status).toBe("completed");
  });
});
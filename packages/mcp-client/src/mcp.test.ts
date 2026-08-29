import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "@clpc/tools";
import { McpClientBase, McpRequestTransport } from "./base";
import { HttpClientTransport } from "./http";
import {
  buildMcpToolKey,
  mcpToolToClpcTool,
  registerMcpTools,
} from "./tools";
import { McpCallResult, McpServerConfig, McpServerInfo } from "./types";

function makeTool(name: string, description = `Runs ${name}`) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" } },
    },
  };
}

class FakeTransport implements McpRequestTransport {
  sent: string[] = [];
  private messageHandler: (raw: string) => void = () => {};

  queue: Array<{ id: string | number; result: unknown }> = [];

  start(): Promise<void> {
    return Promise.resolve();
  }

  async send(raw: string): Promise<void> {
    this.sent.push(raw);
    const parsed = JSON.parse(raw);
    if (parsed.id == null) return;
    const queued = this.queue.shift();
    if (queued) {
      this.messageHandler(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: queued.result }));
    }
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(): void {}

  close(): Promise<void> {
    return Promise.resolve();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mcpToolToClpcTool", () => {
  it("maps an MCP tool definition to a CLPC tool with a namespaced key", async () => {
    const client = {
      async callTool(name: string): Promise<McpCallResult> {
        return { content: [{ type: "text", text: `ran ${name}` }] };
      },
    };
    const tool = mcpToolToClpcTool(makeTool("list files"), client, "local");

    expect(tool.name).toBe(buildMcpToolKey("local", "list files"));
    expect(tool.name).toBe("mcp_local_list_files");
    expect(tool.description).toBe("Runs list files");
    expect(tool.requiresApproval).toBe(false);

    const result = await tool.execute(
      { id: "1", name: tool.name, arguments: {} },
      {}
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe("ran list files");
  });

  it("maps tool errors to failure results", async () => {
    const client = {
      async callTool(): Promise<McpCallResult> {
        return { isError: true, content: [{ type: "text", text: "nope" }] };
      },
    };
    const tool = mcpToolToClpcTool(makeTool("files"), client, "remote");
    const result = await tool.execute({ id: "1", name: tool.name }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("nope");
  });

  it("sanitizes unsafe characters in generated names", () => {
    expect(buildMcpToolKey("my server/1", "read file!")).toBe("mcp_my_server_1_read_file_");
  });
});

describe("registerMcpTools", () => {
  it("registers all exposed MCP tools into a ToolRegistry", async () => {
    const client = {
      info: { name: "demo", version: "1.0" } as McpServerInfo,
      async listTools() {
        return [makeTool("alpha"), makeTool("beta")];
      },
      async callTool(name: string): Promise<McpCallResult> {
        return { content: [{ type: "text", text: `called ${name}` }] };
      },
    };
    const registry = new ToolRegistry();
    const names = await registerMcpTools(client, registry);

    expect(names).toEqual(["mcp_demo_alpha", "mcp_demo_beta"]);
    expect(registry.size).toBe(2);
    expect(registry.find("mcp_demo_beta")).toBeDefined();
  });
});

describe("McpClientBase", () => {
  it("performs the initialize handshake then lists tools", async () => {
    const transport = new FakeTransport();
    const client = new McpClientBase(
      { id: "demo", name: "Demo", transport: "stdio", command: "bogus" },
      transport
    );

    transport.queue = [
      { id: 1, result: { serverInfo: { name: "demo", version: "1.0" } } },
      { id: 2, result: { tools: [makeTool("alpha")] } },
    ];

    await client.connect();
    expect(client.info?.name).toBe("demo");
    expect(transport.sent[0]).toContain('"initialize"');
    expect(transport.sent[1]).toContain("notifications/initialized");

    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["alpha"]);
  });

  it("rejects when the timeout elapses without a response", async () => {
    const transport = new FakeTransport();
    const client = new McpClientBase(
      { id: "slow", name: "Slow", transport: "stdio", command: "bogus" },
      transport,
      60
    );
    transport.queue = [{ id: 1, result: { serverInfo: { name: "demo", version: "1" } } }];

    await client.connect();

    await expect(client.callTool("slow", {})).rejects.toThrow(/timed out/);
  });
});

describe("HttpClientTransport", () => {
  it("POSTs to {url}/mcp and parses SSE message payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n",
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const config: McpServerConfig = { id: "http1", name: "HTTP", transport: "http", url: "https://example.com" };
    const transport = new HttpClientTransport(config);
    const received: string[] = [];
    transport.onMessage((raw) => received.push(raw));
    await transport.start();

    await transport.send('{"jsonrpc":"2.0","id":1,"method":"ping"}');

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/mcp",
      expect.objectContaining({ method: "POST" })
    );
    expect(received.length).toBe(1);
    expect(JSON.parse(received[0]).result.ok).toBe(true);
  });

  it("captures and resends the mcp-session-id header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json", "Mcp-Session-Id": "sess-123" },
        })
      )
      .mockResolvedValueOnce(
        new Response('{"ok":true}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const config: McpServerConfig = { id: "http2", name: "HTTP", transport: "http", url: "https://example.com" };
    const transport = new HttpClientTransport(config);
    await transport.send("{}");
    await transport.send("{}");

    const secondRequest = fetchMock.mock.calls[1][1] as { headers: Record<string, string> };
    expect(secondRequest.headers["Mcp-Session-Id"]).toBe("sess-123");
  });

  it("does not double-append /mcp when the configured url already ends with /mcp", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const config: McpServerConfig = {
      id: "http3",
      name: "HTTP",
      transport: "http",
      url: "https://example.com/7thzqnj22b7-mte22lwo-lzcuacbyvqd/mcp",
    };
    const transport = new HttpClientTransport(config);
    await transport.send("{}");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/7thzqnj22b7-mte22lwo-lzcuacbyvqd/mcp",
      expect.objectContaining({ method: "POST" })
    );
  });
});
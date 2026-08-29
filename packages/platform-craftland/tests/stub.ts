import http, { Server } from "http";
import { AddressInfo } from "net";

export interface StubMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  handler?: (args: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface StubMcpServerOptions {
  serverName?: string;
  serverVersion?: string;
  tools?: StubMcpTool[];
  resources?: Array<{ uri: string; name?: string; description?: string }>;
  toolsListError?: boolean;
}

export interface StubMcpServer {
  url: string;
  port: number;
  requests: Array<{ method: string; id?: number | string | null }>;
  setTools(tools: StubMcpTool[]): void;
  setServerName(name: string): void;
  setToolsListError(value: boolean): void;
  close(): Promise<void>;
}

const DEFAULT_TOOLS: StubMcpTool[] = [
  {
    name: "set_spawn_point",
    description: "Set the spawn point for the current map",
    inputSchema: {
      type: "object",
      properties: {
        position: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
        },
      },
    },
  },
  {
    name: "get_map_info",
    description: "Get information about the current map",
    inputSchema: { type: "object", properties: {} },
  },
];

const DEFAULT_RESOURCES = [
  { uri: "resource://projects/Isle Land", name: "Isle Land" },
  { uri: "resource://projects/Isle Land/scenes/Beach", name: "Beach" },
];

function cloneTools(tools: StubMcpTool[]): StubMcpTool[] {
  return tools.map((tool) => ({ ...tool }));
}

function json(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function createStubMcpServer(options: StubMcpServerOptions = {}): Promise<StubMcpServer> {
  return new Promise((resolve, reject) => {
    let serverName = options.serverName ?? "FE Demo";
    const serverVersion = options.serverVersion ?? "1.2.3";
    let tools = options.tools ? cloneTools(options.tools) : cloneTools(DEFAULT_TOOLS);
    let toolsListError = options.toolsListError ?? false;
    const resources = options.resources
      ? structuredClone(options.resources)
      : structuredClone(DEFAULT_RESOURCES);
    const requests: StubMcpServer["requests"] = [];

    const server: Server = http.createServer((req, res) => {
      void (async () => {
        if (req.method !== "POST" || req.url !== "/mcp") {
          res.writeHead(404).end();
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const message = json(Buffer.concat(chunks).toString("utf-8"));
        if (!message) {
          res.writeHead(400).end();
          return;
        }

        const id = message.id ?? null;
        const method = typeof message.method === "string" ? message.method : "unknown";
        requests.push({ method, id });
        const params = (message.params ?? {}) as Record<string, unknown>;

        if (id === null || id === undefined) {
          res.writeHead(202).end();
          return;
        }

        const respond = (result: unknown) => {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "test-session-1",
          });
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
        };

        const fail = (code: number, messageText: string) => {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "test-session-1",
          });
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id, error: { code, message: messageText } })
          );
        };

        switch (method) {
          case "initialize":
            respond({
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: serverName, version: serverVersion },
            });
            break;
          case "tools/list":
            if (toolsListError) {
              fail(-32602, "tools/list failed");
              break;
            }
            respond({ tools });
            break;
          case "tools/call": {
            const name =
              typeof params.name === "string" ? params.name : "";
            const tool = tools.find((t) => t.name === name);
            const args = (params.arguments ?? {}) as Record<string, unknown>;
            if (!tool) {
              fail(-32602, `Unknown tool: ${name}`);
              break;
            }
            const output = tool.handler ? await tool.handler(args) : { ok: true };
            respond({
              content: [
                { type: "text", text: JSON.stringify(output) },
              ],
              isError: false,
            });
            break;
          }
          case "resources/list":
            respond({ resources });
            break;
          case "resources/read":
            respond({
              contents: [],
            });
            break;
          case "notifications/initialized":
            res.writeHead(202).end();
            break;
          default:
            fail(-32601, `Method not found: ${method}`);
        }
      })().catch(() => res.writeHead(500).end());
    });

    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        port: address.port,
        requests,
        setTools(next) {
          tools = structuredClone(next);
        },
        setServerName(name) {
          serverName = name;
        },
        setToolsListError(value) {
          toolsListError = value;
        },
        close() {
          return new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
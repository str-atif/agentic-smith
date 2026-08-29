import {
  McpCallResult,
  McpClient,
  McpResource,
  McpResourceResult,
  McpServerConfig,
  McpServerInfo,
  McpToolDefinition,
} from "./types";
import {
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  MCP_PROTOCOL_VERSION,
  McpError,
  JsonRpcResponse,
  assertJsonRpcResponse,
  buildNotification,
  buildRequest,
} from "./jsonrpc";

export interface McpRequestTransport {
  start(): Promise<void>;
  send(raw: string): Promise<void>;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: () => void): void;
  close(): Promise<void>;
}

interface PendingRequest {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class McpClientBase implements McpClient {
  private readonly transport: McpRequestTransport;
  private readonly timeoutMs: number;
  private pending = new Map<number | string, PendingRequest>();
  private connected = false;
  private closed = false;

  info: McpServerInfo | null = null;

  constructor(
    _config: McpServerConfig,
    transport: McpRequestTransport,
    timeoutMs = REQUEST_TIMEOUT_MS
  ) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.transport.onMessage((raw) => this.dispatch(raw));
    this.transport.onClose(() => this.handleClose());
  }

  async connect(): Promise<void> {
    await this.transport.start();
    this.connected = true;

    try {
      const response = await this.request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
      });

      const result = response.result as {
        protocolVersion?: string;
        capabilities?: Record<string, unknown>;
        serverInfo?: { name?: string; version?: string };
      };
      this.info = result.serverInfo ?? null;

      await this.notify("notifications/initialized", {});
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpError(-32000, "MCP client disconnected"));
    }
    this.pending.clear();
    await this.transport.close();
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const response = await this.request("tools/list", {});
    const result = response.result as { tools?: McpToolDefinition[] };
    return result.tools ?? [];
  }

  async listResources(): Promise<McpResource[]> {
    const response = await this.request("resources/list", {});
    const result = response.result as { resources?: McpResource[] };
    return result.resources ?? [];
  }

  async readResource(uri: string): Promise<McpResourceResult> {
    const response = await this.request("resources/read", { uri });
    return response.result as McpResourceResult;
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<McpCallResult> {
    const response = await this.request("tools/call", { name, arguments: args ?? {} });
    return response.result as McpCallResult;
  }

  private ensureConnected(): void {
    if (!this.connected || this.closed) {
      throw new McpError(-32000, "MCP client is not connected");
    }
  }

  private async request(
    method: string,
    params?: unknown
  ): Promise<JsonRpcResponse> {
    this.ensureConnected();
    const request = buildRequest(method, params);
    if (request.id == null) {
      throw new McpError(-32603, "MCP request must have a non-null id");
    }
    const id = request.id;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(-32000, `MCP request timed out: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      void this.transport.send(JSON.stringify(request)).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    const notification = buildNotification(method, params);
    await this.transport.send(JSON.stringify(notification));
  }

  private dispatch(raw: string): void {
    let response: JsonRpcResponse;
    try {
      response = assertJsonRpcResponse(JSON.parse(raw));
    } catch {
      return;
    }
    const pending = this.pending.get(response.id ?? "");
    if (!pending) return;
    this.pending.delete(response.id ?? "");
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(
        new McpError(response.error.code, response.error.message, response.id)
      );
      return;
    }
    pending.resolve(response);
  }

  private handleClose(): void {
    if (!this.closed) {
      this.closed = true;
      this.connected = false;
    }
  }
}
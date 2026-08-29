import { McpClient, McpServerConfig } from "@clpc/mcp-client";

export interface CraftlandPlatform {
  detectCraftland(): Promise<boolean>;
  discoverMcpServer(): Promise<McpServerConfig | null>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface CraftlandIntegrationOptions {
  client?: McpClient;
  serverConfig?: McpServerConfig;
}

export class CraftlandIntegration implements CraftlandPlatform {
  private readonly client?: McpClient;
  private readonly serverConfig?: McpServerConfig;

  constructor(options: CraftlandIntegrationOptions = {}) {
    this.client = options.client;
    this.serverConfig = options.serverConfig;
  }

  async detectCraftland(): Promise<boolean> {
    return false;
  }

  async discoverMcpServer(): Promise<McpServerConfig | null> {
    return null;
  }

  async connect(): Promise<void> {
    if (!this.client) {
      throw new Error(
        "Craftland integration has no MCP client configured; discovery (Phase 2+) supplies one."
      );
    }
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    await this.client.disconnect();
  }

  getServerConfig(): McpServerConfig | null {
    return this.serverConfig ?? null;
  }
}
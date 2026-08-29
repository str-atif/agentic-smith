import { McpServerConfig, McpClient } from "./types";
import { McpClientBase } from "./base";
import { HttpClientTransport } from "./http";
import { StdioClientTransport } from "./stdio";

export function createMcpClient(config: McpServerConfig): McpClient {
  switch (config.transport) {
    case "http":
      return new McpClientBase(config, new HttpClientTransport(config));
    case "stdio":
      return new McpClientBase(config, new StdioClientTransport(config));
    default:
      throw new Error(`Unsupported MCP transport: ${(config as McpServerConfig).transport}`);
  }
}
export type McpTransportKind = "http" | "stdio";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportKind;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}

export interface McpResourceResult {
  contents: McpResourceContent[];
}

export interface McpCallContent {
  type: string;
  text?: string;
}

export interface McpCallResult {
  content: McpCallContent[];
  isError?: boolean;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
}

export interface McpClient {
  readonly info: McpServerInfo | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  listResources(): Promise<McpResource[]>;
  readResource(uri: string): Promise<McpResourceResult>;
  callTool(name: string, args?: Record<string, unknown>): Promise<McpCallResult>;
}
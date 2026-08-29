export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_CLIENT_NAME = "clpc-smith";
export const MCP_CLIENT_VERSION = "0.1.0";

let requestCounter = 0;

export function nextRequestId(): number {
  requestCounter += 1;
  return requestCounter;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function buildRequest(method: string, params?: unknown, id: number | string | null = nextRequestId()): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

export function buildNotification(method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: null, method, ...(params !== undefined ? { params } : {}) };
}

export class McpError extends Error {
  readonly code: number;
  readonly requestId: number | string | null;

  constructor(code: number, message: string, requestId: number | string | null = null) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.requestId = requestId;
  }
}

export function assertJsonRpcResponse(raw: unknown): JsonRpcResponse {
  if (raw && typeof raw === "object") {
    const obj = raw as JsonRpcResponse;
    if (obj.jsonrpc === "2.0" && ("result" in obj || "error" in obj)) {
      return obj;
    }
  }
  throw new McpError(-32700, "Invalid JSON-RPC response from MCP server");
}
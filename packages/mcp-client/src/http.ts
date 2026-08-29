import { McpServerConfig } from "./types";
import { McpRequestTransport } from "./base";

function extractSsePayloads(text: string): string[] {
  const payloads: string[] = [];
  let buffer = "";
  let sawEvent = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      const event = line.slice(6).trim();
      if (event !== "message") continue;
      sawEvent = true;
    } else if (line.startsWith("data:")) {
      const data = line.slice(5).trimStart();
      if (data === "[DONE]") continue;
      buffer += data;
      sawEvent = true;
    } else if (line.trim() === "") {
      if (sawEvent && buffer.trim()) {
        payloads.push(buffer.trim());
      }
      buffer = "";
      sawEvent = false;
    }
  }
  if (sawEvent && buffer.trim()) {
    payloads.push(buffer.trim());
  }
  return payloads;
}

export class HttpClientTransport implements McpRequestTransport {
  private config: McpServerConfig;
  private sessionId?: string;
  private messageHandler: (raw: string) => void = () => {};
  private closeHandler: () => void = () => {};

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {}

  async send(raw: string): Promise<void> {
    if (!this.config.url) {
      throw new Error("MCP HTTP transport requires a url");
    }
    const baseUrl = this.config.url.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.config.headers,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const endpoint = baseUrl.endsWith("/mcp") ? baseUrl : `${baseUrl}/mcp`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: raw,
    });

    const sessionHeader = response.headers.get("mcp-session-id");
    if (sessionHeader) {
      this.sessionId = sessionHeader;
    }

    if (response.status === 202) {
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const bodyText = await response.text();

    if (contentType.includes("text/event-stream")) {
      for (const payload of extractSsePayloads(bodyText)) {
        this.messageHandler(payload);
      }
      return;
    }

    if (bodyText.trim()) {
      this.messageHandler(bodyText);
    }
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  async close(): Promise<void> {
    this.closeHandler();
  }
}
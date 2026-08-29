import {
  ChatRequest,
  ChatResponse,
  StreamingEvent,
  ToolCallRequest,
} from "@clpc/types";
import { BaseModelProvider } from "./types";

export interface OpenAICompatibleConfig {
  id: string;
  displayName: string;
  modelName: string;
  apiKey?: string;
  baseUrl: string;
  orgId?: string;
  projectId?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  streamingEnabled?: boolean;
}

interface OpenAIStreamChunk {
  id: string;
  choices: {
    delta: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }[];
}

interface OpenAICompletion {
  id: string;
  choices: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments?: string };
      }>;
    };
  }>;
}

function toApiMessages(messages: ChatRequest["messages"]) {
  return messages.map((message) => {
    switch (message.role) {
      case "tool":
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        };
      case "assistant":
        return {
          role: "assistant",
          content: message.content,
          tool_calls: message.toolCalls
            ? message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments ?? {}),
                },
              }))
            : undefined,
        };
      default:
        return { role: message.role, content: message.content };
    }
  });
}

function toApiTools(tools: ChatRequest["tools"]) {
  return (tools ?? []).map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const endpoint = "/chat/completions";
  if (base.endsWith(endpoint)) {
    return base;
  }
  if (base.endsWith("/v1")) {
    return `${base}${endpoint}`;
  }
  return `${base}/v1${endpoint}`;
}

function parseToolCall(
  call: { id?: string; function: { name?: string; arguments?: string } },
  index: number
): ToolCallRequest {
  let parsedArguments: Record<string, unknown> = {};
  if (call.function.arguments) {
    try {
      const parsed = JSON.parse(call.function.arguments);
      if (parsed && typeof parsed === "object") {
        parsedArguments = parsed as Record<string, unknown>;
      }
    } catch {
      parsedArguments = {};
    }
  }
  return {
    id: call.id ?? `call_${index}`,
    name: call.function.name ?? "unknown",
    arguments: parsedArguments,
  };
}

interface StreamToolAccumulator {
  id?: string;
  name?: string;
  arguments?: string;
}

export class OpenAICompatibleProvider extends BaseModelProvider {
  protected readonly apiKey?: string;
  protected readonly baseUrl: string;
  protected readonly apiLabel: string;
  protected readonly customHeaders: Record<string, string>;
  protected readonly timeoutMs?: number;
  protected readonly streamingEnabled: boolean;
  protected readonly orgId?: string;
  protected readonly projectId?: string;

  constructor(config: OpenAICompatibleConfig) {
    super({ ...config, supportsStreaming: config.streamingEnabled ?? true });
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.apiLabel = config.id;
    this.customHeaders = { ...(config.headers ?? {}) };
    this.timeoutMs = config.timeoutMs;
    this.streamingEnabled = config.streamingEnabled ?? true;
    this.orgId = config.orgId;
    this.projectId = config.projectId;
  }

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const data = await this.post(request) as OpenAICompletion;
    const message = data.choices[0]?.message;
    const toolCalls = message?.tool_calls
      ?.map((call, index) => parseToolCall(call, index))
      .filter((call) => call.name !== "unknown");

    return {
      id: data.id,
      content: message?.content ?? "",
      modelId: this.id,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamingEvent> {
    if (!this.streamingEnabled) {
      const response = await this.complete(request);
      if (response.content) {
        yield { type: "token", content: response.content };
      }
      for (const toolCall of response.toolCalls ?? []) {
        yield { type: "tool_call", toolCall };
      }
      yield { type: "done" };
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;
    const response = await this.fetchStream(request, signal);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.apiLabel} API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`No response body from ${this.apiLabel}`);
    }

    const toolAccumulator = new Map<number, StreamToolAccumulator>();

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = (): void => {
      if (!this.timeoutMs || this.timeoutMs <= 0) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!signal.aborted) controller.abort();
      }, this.timeoutMs);
    };

    try {
      const decoder = new TextDecoder();
      armIdle();

      try {
        for await (const line of this.readLine(reader, decoder)) {
          armIdle();
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const chunk = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk;
            const delta = chunk.choices[0]?.delta;

            if (delta?.content) {
              yield { type: "token", content: delta.content };
            }

            if (delta?.tool_calls) {
              for (const fragment of delta.tool_calls) {
                const index = fragment.index ?? 0;
                const accumulated = toolAccumulator.get(index) ?? {};
                if (fragment.id) accumulated.id = fragment.id;
                if (fragment.function?.name) accumulated.name = fragment.function.name;
                if (fragment.function?.arguments) {
                  accumulated.arguments =
                    (accumulated.arguments ?? "") + fragment.function.arguments;
                }
                toolAccumulator.set(index, accumulated);
              }
            }
          } catch {
            // skip malformed chunk
          }
        }
      } catch (error) {
        if (signal.aborted) {
          throw new Error(
            `${this.apiLabel} streaming timed out: no data received for ${this.timeoutMs}ms`
          );
        }
        throw error;
      }

      for (const [index, accumulated] of toolAccumulator) {
        if (!accumulated.name) continue;
        yield {
          type: "tool_call",
          toolCall: parseToolCall(
            {
              id: accumulated.id,
              function: { name: accumulated.name, arguments: accumulated.arguments },
            },
            index
          ),
        };
      }

      yield { type: "done" };
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      reader.releaseLock();
    }
  }

  private async *readLine(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder
  ): AsyncGenerator<string> {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        yield line;
      }
    }
    if (buffer.trim()) {
      yield buffer;
    }
  }

  private async post(request: ChatRequest): Promise<unknown> {
    const response = await this.fetchStream(request);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.apiLabel} API error: ${response.status} - ${error}`);
    }
    return response.json();
  }

  private async fetchStream(request: ChatRequest, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.customHeaders,
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (!headers["OpenAI-Organization"] && this.orgId) {
      headers["OpenAI-Organization"] = this.orgId;
    }
    if (!headers["OpenAI-Project"] && this.projectId) {
      headers["OpenAI-Project"] = this.projectId;
    }

    const fetchOptions: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.modelName,
        messages: toApiMessages(request.messages),
        tools: request.tools && request.tools.length > 0 ? toApiTools(request.tools) : undefined,
        stream: request.stream ?? false,
      }),
    };
    if (signal) {
      fetchOptions.signal = signal;
    } else if (this.timeoutMs && this.timeoutMs > 0) {
      fetchOptions.signal = AbortSignal.timeout(this.timeoutMs);
    }
    const url = buildChatCompletionsUrl(this.baseUrl);
    if (process.env.CLPC_DEBUG_PROVIDER === "1") {
      console.log(
        `[clpc:provider] POST ${url} (base: ${this.baseUrl})`
      );
    }
    return fetch(url, fetchOptions);
  }
}
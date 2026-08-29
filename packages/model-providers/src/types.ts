import {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamingEvent,
} from "@clpc/types";

export interface BaseModelProviderConfig {
  id: string;
  displayName: string;
  modelName: string;
  supportsStreaming?: boolean;
}

export abstract class BaseModelProvider implements ModelProvider {
  readonly id: string;
  readonly displayName: string;
  readonly modelName: string;
  readonly supportsStreaming: boolean;

  constructor(config: BaseModelProviderConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
    this.modelName = config.modelName;
    this.supportsStreaming = config.supportsStreaming ?? true;
  }

  abstract complete(request: ChatRequest): Promise<ChatResponse>;

  async *stream(request: ChatRequest): AsyncIterable<StreamingEvent> {
    const response = await this.complete(request);
    yield { type: "token", content: response.content };
    yield { type: "done" };
  }
}
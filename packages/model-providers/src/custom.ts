import { OpenAICompatibleProvider } from "./openaiCompatible";

export interface CustomOpenAIProviderConfig {
  apiKey?: string;
  baseUrl: string;
  modelName: string;
  label?: string;
  orgId?: string;
  projectId?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  streaming?: boolean;
}

const GENERIC_ID = "openai-compatible";

export class CustomOpenAIProvider extends OpenAICompatibleProvider {
  constructor(config: CustomOpenAIProviderConfig) {
    if (!config.baseUrl) {
      throw new Error("A base URL is required for an OpenAI-compatible provider");
    }
    const modelName = config.modelName || "gpt-4o-mini";
    super({
      id: GENERIC_ID,
      displayName: config.label || modelName,
      modelName,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      orgId: config.orgId,
      projectId: config.projectId,
      headers: config.headers,
      timeoutMs: config.timeoutMs,
      streamingEnabled: config.streaming,
    });
  }
}
import { OpenAICompatibleProvider } from "./openaiCompatible";

export interface OpenAIProviderConfig {
  apiKey: string;
  modelName?: string;
  baseUrl?: string;
  label?: string;
}

const DEFAULT_MODEL = "gpt-4o";

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(config: OpenAIProviderConfig) {
    const modelName = config.modelName || DEFAULT_MODEL;
    super({
      id: "openai",
      displayName: config.label || modelName,
      modelName,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://api.openai.com/v1",
    });
  }
}